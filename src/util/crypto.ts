import { SECRET } from "../config/constant"
import Cryptr from "cryptr"

export const decryptAES = (strToDecrypt: string) => {
  const crypto = new Cryptr(SECRET)
  return crypto.decrypt(strToDecrypt);
} 