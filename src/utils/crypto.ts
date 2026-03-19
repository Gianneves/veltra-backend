import { createCipheriv, randomBytes, createDecipheriv } from 'crypto';
import dotenv from 'dotenv'
dotenv.config()

const secretKey = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')

export const encrypt = (token: string) => {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', secretKey, iv)

    const encrypted = cipher.update(token, 'utf-8', 'hex') + cipher.final('hex')

    const authTag = cipher.getAuthTag()

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export const decrypt = (data: string) => {
    const parts = data.split(':')

    if (parts.length !== 3) {
        throw new Error('Formato inválido do token criptografado')
    }

    const [ivHex, authTagHex, encrypted] = parts as [string, string, string]

    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    const decipher = createDecipheriv('aes-256-gcm', secretKey, iv)
    decipher.setAuthTag(authTag)

    const decrypted =
        decipher.update(encrypted, 'hex', 'utf-8') +
        decipher.final('utf-8')

    return decrypted
}