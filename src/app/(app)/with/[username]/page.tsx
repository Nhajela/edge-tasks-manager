import { Placeholder } from "@/components/Placeholder";

export default async function WithPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <Placeholder title={`With @${decodeURIComponent(username)}`} />;
}
