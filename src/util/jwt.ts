import jwt, { Algorithm, Jwt, Secret, SignOptions } from 'jsonwebtoken'
import { JWT_ACCESS_TOKEN_EXPIRY_IN_SECONDS, PRIVATE_KEY_PATH } from '../config/constant';
import { ARError } from './error';
import { readFileSync } from 'fs';


export type UserJWTData = {
  id: number,
  name: string,
  email?: string | null,
  whatsapp_number?: string,
  sessionId?: string,
  type?: string
}

export type JWTTokenData = (UserJWTData | EmailVerificationJWT | ResetPasswordJWT | ResendOTPJWT | SessionTokenJWT )

export type EmailVerificationJWT = {
  type: 'emailVerificationJWT',
  email: string,
  randomString: string
}

export type ResetPasswordJWT = {
  type: 'resetPasswordJWT',
  email: string,
  randomString: string
}

export type ResendOTPJWT = {
  type: 'resendOTPJWT',
  whatsapp_number: string,
  user_id?: number,
  temp_user_id?: number
}

export type SessionTokenJWT = {
  type: 'sessionToken',
  user_id: number,
  whatsapp_number: string
}

export const generateUserJWT = async (data: UserJWTData, opts: SignOptions = {}, expiry_in_second?: number): Promise<string> => {
  return signJWT({
    id: data.id,
    name: data.name,
    email: data.email,
    sessionId: data.sessionId
  }, {
    expiresIn: expiry_in_second ? expiry_in_second : JWT_ACCESS_TOKEN_EXPIRY_IN_SECONDS,
    ...opts
  })
}


export const signJWT = (payload: Record<string, any>, opts: SignOptions = {}): string => {
  return jwt.sign(payload, getSecretOrPrivateKey(), {
    algorithm: 'ES256',
    ...opts
  })
}

const getSecretOrPrivateKey = (): Secret => {
  const secret = process.env.JWT_SECRET;
  const privateKey = PRIVATE_KEY_PATH ? readFileSync(PRIVATE_KEY_PATH) : null
  const secretOrKey = privateKey ? privateKey : secret
  if (!secretOrKey) {
    throw new ARError('JWT secret or private key not found', {
      status: 500
    })
  }
  return secretOrKey
}

export const verifyJWT = (jwtToken: string, algorithms: Algorithm[] = ['ES256'], secret?: string): JWTTokenData => {
  return jwt.verify(jwtToken, secret ? secret : getSecretOrPrivateKey(), {
    algorithms: algorithms
  }) as JWTTokenData
}


export const generateSuperadminJWT = async (data: UserJWTData, opts: SignOptions = {}): Promise<string> => {
  return signJWT({
    type: 'superadmin',
    id: data.id,
    name: data.name,
    email: data.email,
    sessionId: data.sessionId
  }, {
    expiresIn: JWT_ACCESS_TOKEN_EXPIRY_IN_SECONDS,
    ...opts
  })
}