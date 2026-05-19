export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
};

export type BottomTabParamList = {
  DashboardTab: undefined;
  LeadsTab: undefined;
  CampaignsTab: undefined;
  ActivityTab: undefined;
  MoreTab: undefined;
};

export type LeadsStackParamList = {
  HotLeads: undefined;
  LeadDetail: { leadId: string; companyName: string };
  CallTranscript: { callId: string; leadId: string; companyName: string };
};

export type CampaignsStackParamList = {
  CampaignsList: undefined;
  CampaignDetail: { campaignId: string; campaignName: string };
  EditPacing: { campaignId: string; campaignName: string };
};

export type ActivityStackParamList = {
  RecentCalls: undefined;
  TranscriptDetail: { callId: string; companyName: string };
  MeetingsBooked: undefined;
};

export type MoreStackParamList = {
  MoreMenu: undefined;
  QueueMonitor: undefined;
  Profile: undefined;
};
