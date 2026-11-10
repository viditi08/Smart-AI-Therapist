import { redirect } from "next/navigation";

export const metadata = {
  title: "Talk with Emma",
  description: "A live voice session with Emma over LiveKit.",
};

export default function PipelineSessionPage() {
  redirect("/session/voice");
}
