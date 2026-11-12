import { user, user_session } from '@prisma/client'

declare global {
  namespace Express {
    export interface Request {
      user?: user,
      session?: user_session,
    }
  }
}

export {}