export interface VerifyEmailPayload {
  userId: string;
  email: string;
  verificationToken: string;
}

export interface PasswordResetPayload {
  userId: string;
  email: string;
  resetToken: string;
}

// Phase 11: OrgInvitePayload · Phase 21: PipelinePayload · Phase 22: BudgetWarningPayload
