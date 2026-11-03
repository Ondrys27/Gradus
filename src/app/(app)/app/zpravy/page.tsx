import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MessagesView } from "@/features/chat/messages-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("messages") };
}

export default function MessagesPage() {
  return (
    <Suspense>
      <MessagesView />
    </Suspense>
  );
}
