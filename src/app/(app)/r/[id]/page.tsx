import { Placeholder } from "@/components/Placeholder";
import { AiQuestionCard } from "@/components/request/AiQuestionCard";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Placeholder title={`#${id}`}>
      <AiQuestionCard requestId={Number(id)} question={null} canAnswer={false} />
    </Placeholder>
  );
}
