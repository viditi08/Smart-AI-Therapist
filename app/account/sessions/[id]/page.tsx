import { getSession } from "@/lib/session";
import { SavedSessionViewer } from "@/components/saved-session-viewer";

type PageProps = { params: Promise<{ id: string }> };

export default async function SavedSessionPage({ params }: PageProps) {
  const session = await getSession();
  if (!session?.user) {
    return null;
  }
  const { id } = await params;
  return <SavedSessionViewer sessionId={id} />;
}
