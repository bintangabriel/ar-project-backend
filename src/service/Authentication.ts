import { decryptAES } from "../util/crypto"
import prisma from "../prisma"
import { JWT_ACCESS_TOKEN_EXPIRY_IN_SECONDS } from "../config/constant"
import { ARError } from "../util/error"
import { generateUserJWT } from "../util/jwt"
import { compare } from 'bcrypt'
import { UAParser } from "ua-parser-js"
import { ulid } from 'ulid'

export interface SessionData {
  userAgent?: string,
  ip?: string,
  data?: any
}

export type AuthSlug = 'email' | 'google'

export type LoginData = {
  grantType?: 'password',
  password?: string,
  email?: string
  redirect_uri?: string,
  code?: string
}


export const LoginUser = async (authSlug: AuthSlug, loginData: LoginData, sessionData: SessionData) => {
  if (authSlug === 'email' && loginData.grantType !== 'password') {
    throw new ARError('grantType other than password is not yet implemented', { status: 400 })
  }

  if (authSlug === 'email') {
    return loginEmail(loginData, sessionData)
  }
  return
}

const loginEmail = async (loginData: LoginData, sessionData: SessionData) => {
  const decyrptedEmail = decryptAES(loginData.email!)
  const decyrptedPassword = decryptAES(loginData.password!)
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: decyrptedEmail },
        { email: decyrptedEmail.toLowerCase() }
      ],
      deleted_at: null
    }
  })

  if (!user) {
    throw new ARError('Invalid Credentials', { status: 401 })
  }

  if (!user.password) {
    throw new ARError('Invalid Credentials', { status: 401 })
  }

  const isPasswordCorrect = await compare(decyrptedPassword, user.password)
  if (!isPasswordCorrect) {
    throw new ARError('Invalid Credentials', { status: 401 })
  }

  const sessionId = await saveLoginSession(user.id, sessionData)
  const jwtToken = await generateUserJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    sessionId: sessionId
  })

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      is_email_verified: user.is_email_verified,
      whatsapp_number: user.whatsapp_number,
      timezone: user.timezone,
      profilePictureUrl: user.profile_picture_url,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    jwt: {
      token: jwtToken,
    },
    is_new_user: false
  }
}

export async function saveLoginSession(id: string, sessionData: SessionData, expiry_in_seconds?: number): Promise<string> {
  const userAgent = sessionData.userAgent ? new UAParser(sessionData.userAgent) : undefined
  const ip = sessionData.ip ?? null
  const data = sessionData.data ?? null
  const jwtExpiry = expiry_in_seconds ? expiry_in_seconds : JWT_ACCESS_TOKEN_EXPIRY_IN_SECONDS
  console.log("jwt : " + Number(jwtExpiry))
  const expiredAt = new Date(new Date().getTime() + Number(jwtExpiry) * 1000)
  const sessionId = ulid()
  const device = sessionData.userAgent ?? new UAParser(sessionData.userAgent).getDevice()['model']
  const os = sessionData.userAgent ?? new UAParser(sessionData.userAgent).getOS()['name']


  await prisma.user_session.create({
    data: {
      id: sessionId,
      expired_at: expiredAt,
      user_agent: userAgent ? JSON.parse(JSON.stringify(userAgent.getResult())) : null,
      ip: ip,
      data: data,
      user_id: id,
    }
  })
  return sessionId
}
