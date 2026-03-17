export type BranchlineRole = "owner" | "admin" | "member" | "viewer";

export interface AuthContext {
  userId: string;
  clerkUserId: string;
  email: string;
  role: BranchlineRole;
}
