import { ARError } from '../util/error'
import { NextFunction, RequestHandler, Request, Response } from "express";
import { UserJWTData, verifyJWT } from '../util/jwt';
import { ErrorCode } from '../config/errorCode';
import prisma from '../prisma';

type Options = {
  throwError: boolean
}

export function UserAuth(): RequestHandler{
  return async function (req: Request, _: Response, next: NextFunction) {
    try {
      const headers = req.headers
      const cookies = req.cookies

      if (!headers?.authorization && !cookies?.authorization && !cookies?.authorization_v2) {
        console.log('Authorization header needed')
        throw new ARError('Authorization header needed', { status: 401, code: ErrorCode.UserAuth.MissingAuthorizationHeader })
      }

      const authorizationType: 'Bearer' = (headers.authorization || cookies.authorization as string || cookies.authorization_v2 as string).split(' ')[0] as 'Bearer'

      if (authorizationType !== 'Bearer') {
        console.log('Authorization type not allowed')
        throw new ARError('Authorization type not allowed', { status: 401, code: ErrorCode.UserAuth.InvalidAuthorizationType })
      }

      const authorizationKey = (headers.authorization || cookies.authorization as string || cookies.authorization_v2 as string).split(' ')[1]!
      try {
        // decode the jwt
        const jwtUser = verifyJWT(authorizationKey) as UserJWTData

        // check if have sessionId
        const sessionId = jwtUser.sessionId
        if (!sessionId) {
          throw new ARError('Failed to verify session', { status: 401,  code: ErrorCode.UserAuth.InvalidSession })
        }

        const accountReq = prisma.user.findFirst({
          where: {
            id: jwtUser.id
          }
        })

        // find the sessionId in the database
        const sessionReq = prisma.user_session.findFirst({
          where: {
            id: sessionId,
            user_id: jwtUser.id,
            expired_at: {
              gt: new Date()
            }
          }
        })

        const [account, session] = await Promise.all([accountReq, sessionReq])

        if (!account) {
          throw new ARError('User not found', { status: 401, code: ErrorCode.UserAuth.UserNotFound })
        }

        if (account.deleted_at) {
          throw new ARError('User not found', { status: 401, code: ErrorCode.UserAuth.UserNotFound })
        }

        if (!session) {
          throw new ARError('Failed to verify session', { status: 401, code: ErrorCode.UserAuth.InvalidSession })
        }
        req.user = account
        req.session = session
      } catch (error) {
        console.log(error)
        console.log('Error Verify Bearer: %j', error)
        throw new ARError('Authorization key invalid', { status: 401, code: ErrorCode.UserAuth.InvalidAuthorizationKey })
      }
  
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
