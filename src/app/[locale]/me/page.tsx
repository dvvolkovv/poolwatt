import { redirect } from "next/navigation";

export default async function CabinetIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/me/favorites`);
}
