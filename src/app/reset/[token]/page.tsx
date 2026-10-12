import { TokenPasswordForm } from "@/components/token-password-form";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <TokenPasswordForm token={(await params).token} />;
}
