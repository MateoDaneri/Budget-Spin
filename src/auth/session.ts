import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/src/db/client";
import { LOCAL_USER_ID, migrate } from "@/src/db/repository";

export const AUTH_COOKIE_NAME = "budgetspin_session";
export const AUTH_USER_ID = LOCAL_USER_ID;

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

type AuthUserRow = {
  id: string;
  username: string | null;
  display_name: string;
  password_hash: string | null;
  password_salt: string | null;
};

export function isPasswordConfigured() {
  const user = getAuthUser();
  return Boolean(user?.password_hash && user.password_salt);
}

export function setUserPassword(password: string) {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  migrate();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);

  getDb()
    .prepare("UPDATE users SET username = ?, password_hash = ?, password_salt = ? WHERE id = ?")
    .run("mdaneri", hash, salt, AUTH_USER_ID);
}

export function verifyCredentials(username: string, password: string) {
  const user = getAuthUser();
  if (!user?.password_hash || !user.password_salt || user.username !== username) {
    return false;
  }

  const candidate = hashPassword(password, user.password_salt);
  const candidateBuffer = Buffer.from(candidate, "hex");
  const storedBuffer = Buffer.from(user.password_hash, "hex");
  return candidateBuffer.length === storedBuffer.length && crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

export async function signIn() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const value = signSession(AUTH_USER_ID, expiresAt);
  const cookieStore = await cookies();

  cookieStore.set(AUTH_COOKIE_NAME, value, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const value = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return value && verifySession(value) ? { userId: AUTH_USER_ID, username: "mdaneri" } : null;
}

export function signSession(userId: string, expiresAt: number) {
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${signature(payload)}`;
}

export function verifySession(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [userId, expiresAtRaw, providedSignature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (userId !== AUTH_USER_ID || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const expected = signature(`${userId}.${expiresAtRaw}`);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function getAuthUser() {
  migrate();
  return getDb()
    .prepare("SELECT id, username, display_name, password_hash, password_salt FROM users WHERE id = ?")
    .get(AUTH_USER_ID) as AuthUserRow | undefined;
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function signature(payload: string) {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function authSecret() {
  return process.env.BUDGETSPIN_AUTH_SECRET ?? "budgetspin-local-dev-secret";
}
