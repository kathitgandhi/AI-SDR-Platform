import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';
import { audit } from '../../shared/audit';
import { enqueueCrmSync } from '../../shared/crm-sync-queue';
import { enqueueEnrichment } from '../../shared/enrichment-queue';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

interface CsvRow {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  company_name?: string;
  company_website?: string;
  retail_vertical?: string;
  store_count?: number | string;
  source?: string;
}

/**
 * POST /api/v1/imports/leads — JSON-body CSV import. Frontend parses the CSV
 * client-side (cheaper than streaming upload) and posts an array of rows.
 *
 * Body: {
 *   rows: CsvRow[],
 *   campaign_id?: uuid,
 *   filename?: string,
 *   default_vertical?: string
 * }
 *
 * Strategy: dedupe by email (then phone), upsert companies + contacts + leads.
 * Returns per-row status so the UI can show what succeeded/failed.
 */
export function createImportsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/imports — list past imports
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase.from('csv_imports').select('*').order('created_at', { ascending: false }).limit(50);
      if (userId) q = q.eq('user_id', userId);
      const { data, error } = await q;
      if (error) throw error;
      res.json({ imports: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/imports/leads
  router.post('/leads', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { rows, campaign_id, filename, default_vertical } = req.body as {
        rows?: CsvRow[]; campaign_id?: string; filename?: string; default_vertical?: string;
      };

      if (!Array.isArray(rows) || rows.length === 0) {
        throw new ValidationError('rows array required and must not be empty');
      }
      if (rows.length > 5000) throw new ValidationError('Max 5000 rows per import');

      // Create the import-record stub
      const { data: importRow, error: importErr } = await supabase
        .from('csv_imports')
        .insert({
          user_id: userId ?? null,
          filename: filename ?? null,
          total_rows: rows.length,
          campaign_id: campaign_id ?? null,
          status: 'processing',
        })
        .select()
        .single();
      if (importErr) throw importErr;

      const errors: Array<{ row: number; message: string }> = [];
      let imported = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] ?? {};
        try {
          const firstName = (row.first_name ?? '').trim();
          if (!firstName) {
            errors.push({ row: i + 1, message: 'first_name is required' });
            continue;
          }
          const email = row.email?.trim().toLowerCase() || null;
          const phone = row.phone?.trim() || null;
          if (!email && !phone) {
            errors.push({ row: i + 1, message: 'email or phone required' });
            continue;
          }

          // 1. Company (upsert by name+website)
          const companyName = (row.company_name ?? 'Unknown').trim();
          const website = row.company_website?.trim() ?? null;
          const storeCount = row.store_count ? Number(row.store_count) : null;

          // Try to find existing company
          let companyId: string;
          const { data: existingCo } = await supabase
            .from('companies')
            .select('id')
            .eq('name', companyName)
            .eq(userId ? 'created_by' : 'id', userId ?? '00000000-0000-0000-0000-000000000000')
            .maybeSingle();

          if (existingCo) {
            companyId = existingCo.id;
          } else {
            const { data: newCo, error: coErr } = await supabase
              .from('companies')
              .insert({
                name: companyName,
                website,
                retail_vertical: (row.retail_vertical ?? default_vertical ?? 'unknown') as any,
                store_count: storeCount,
                created_by: userId ?? null,
              })
              .select('id')
              .single();
            if (coErr) {
              errors.push({ row: i + 1, message: `Company insert: ${coErr.message}` });
              continue;
            }
            companyId = newCo.id;
          }

          // 2. Contact (upsert by email if present)
          let contactId: string;
          if (email) {
            const { data: existingCt } = await supabase
              .from('contacts')
              .select('id')
              .eq('email', email)
              .maybeSingle();
            if (existingCt) {
              contactId = existingCt.id;
            } else {
              const { data: newCt, error: ctErr } = await supabase
                .from('contacts')
                .insert({
                  company_id: companyId,
                  first_name: firstName,
                  last_name: row.last_name?.trim() ?? null,
                  email,
                  phone_direct: phone,
                  title: row.title?.trim() ?? null,
                  created_by: userId ?? null,
                })
                .select('id')
                .single();
              if (ctErr) {
                errors.push({ row: i + 1, message: `Contact insert: ${ctErr.message}` });
                continue;
              }
              contactId = newCt.id;
            }
          } else {
            const { data: newCt, error: ctErr } = await supabase
              .from('contacts')
              .insert({
                company_id: companyId,
                first_name: firstName,
                last_name: row.last_name?.trim() ?? null,
                phone_direct: phone,
                title: row.title?.trim() ?? null,
                created_by: userId ?? null,
              })
              .select('id')
              .single();
            if (ctErr) {
              errors.push({ row: i + 1, message: `Contact insert: ${ctErr.message}` });
              continue;
            }
            contactId = newCt.id;
          }

          // 3. Lead
          const { data: newLead, error: leadErr } = await supabase
            .from('leads')
            .insert({
              campaign_id: campaign_id ?? null,
              contact_id: contactId,
              company_id: companyId,
              stage: 'new',
              source: row.source ?? 'csv_import',
              created_by: userId ?? null,
            })
            .select('id')
            .single();
          if (leadErr || !newLead) {
            errors.push({ row: i + 1, message: `Lead insert: ${leadErr?.message ?? 'unknown'}` });
            continue;
          }

          // Auto-sync to CRM (fire-and-forget)
          enqueueCrmSync('lead', newLead.id, 'create');

          // Advance the lead out of `new`: the enrichment worker normalizes it
          // and routes to phone-lookup (callable/email_only) or email-only
          // enrollment. Without this, CSV-imported leads stall at `new`.
          await enqueueEnrichment({ companyId, leadId: newLead.id, domain: '' });

          imported++;
        } catch (e) {
          errors.push({ row: i + 1, message: (e as Error).message });
        }
      }

      // Mark import as done
      await supabase
        .from('csv_imports')
        .update({
          imported_count: imported,
          failed_count: errors.length,
          errors,
          status: errors.length === rows.length ? 'failed' : 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', importRow.id);

      audit(supabase, logger, req, {
        action: 'bulk_create',
        entity_type: 'lead',
        entity_id: importRow.id,
        changes: { imported, failed: errors.length, total: rows.length, campaign_id },
      });

      res.json({ import_id: importRow.id, imported, failed: errors.length, errors: errors.slice(0, 100) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
