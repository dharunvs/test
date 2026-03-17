import { SetMetadata } from "@nestjs/common";

import type { BranchlineRole } from "./auth.types.js";

export const ROLES_KEY = "roles";

export const Roles = (...roles: BranchlineRole[]) => SetMetadata(ROLES_KEY, roles);
