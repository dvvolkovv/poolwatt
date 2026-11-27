import { z } from "zod";

// Reserved usernames that would impersonate the platform or collide with
// future route prefixes (so /u/admin etc. can never be claimed by a user).
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "support", "help", "system",
  "poolwatt", "owner", "moderator", "mod", "official", "team",
  "info", "contact", "api", "me", "you", "user", "guest",
  "login", "logout", "register", "signup", "signin", "auth",
]);

export const usernameSchema = z
  .string()
  .min(3, "Минимум 3 символа")
  .max(30, "Максимум 30 символов")
  .regex(/^[a-z0-9_-]+$/i, "Допустимы латинские буквы, цифры, _ и -")
  .transform((s) => s.toLowerCase())
  .refine((s) => !RESERVED_USERNAMES.has(s), "Этот ник зарезервирован");

export const passwordSchema = z
  .string()
  .min(8, "Минимум 8 символов")
  .max(72, "Максимум 72 символа")  // bcrypt input cap
  .refine((s) => /[a-zA-Z]/.test(s), "Должна быть хотя бы одна буква")
  .refine((s) => /[0-9]/.test(s), "Должна быть хотя бы одна цифра");

export const emailSchema = z.string().email("Неверный формат email").max(254);

// Zod schemas for forms — each one is a SAFE input parser.
export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Введите пароль"),  // not full validation — login validates against hash
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Введите текущий пароль"),
    newPassword: passwordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "Новый пароль должен отличаться",
    path: ["newPassword"],
  });

export const setPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const addEmailSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (+followed by digits, 7–15 total)");

export const updatePhoneSchema = z.object({
  phone: z.union([phoneSchema, z.literal("")]),  // empty string = clear
});

export const nameSchema = z
  .string()
  .min(1, "Введите имя")
  .max(80, "Максимум 80 символов");

export const updateNameSchema = z.object({
  name: z.union([nameSchema, z.literal("")]),  // empty string = clear
});

// §42's birthday gift needs the day and the month, and nothing else: a year
// would be one more piece of personal data for no extra use. Both empty
// clears the date again.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const updateBirthdaySchema = z
  .object({
    birthDay: z.number().int().min(1).max(31).nullable(),
    birthMonth: z.number().int().min(1).max(12).nullable(),
  })
  .refine((v) => (v.birthDay == null) === (v.birthMonth == null), {
    message: "Give both the day and the month",
  })
  .refine((v) => v.birthDay == null || v.birthDay <= DAYS_IN_MONTH[v.birthMonth! - 1], {
    message: "That month does not have that many days",
  });
