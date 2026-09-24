import { LoginUser, SessionData } from "../service/Authentication";
import { Request, Response } from "express";

export type LoginMobileBody = {
  login: {
    grantType: 'password',
    email: string,
    password: string
  }
}

export async function loginEmailRoute(req: Request<unknown, unknown, LoginMobileBody, unknown>, res: Response) {
  const sessionData: SessionData = {
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.headers['x-forwarded-for'] as string
  }

  const loginResponse = await LoginUser(
    'email',
    req.body.login,
    sessionData
  )

  res.status(200).send(loginResponse)
}   