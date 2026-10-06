"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { StatusPill } from "@/components/ui/status-pill";
import { useSession } from "@/features/account/queries";
import { AppOverview } from "@/features/plan/app-overview";
import { AvatarEditor } from "./avatar-editor";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileDetailsForm } from "./profile-details-form";

export function ProfileView() {
  const t = useTranslations("profile");
  const { roles } = useSession();

  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem>
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={
            roles.includes("owner") ? (
              <StatusPill tone="gold">{t("roles.owner")}</StatusPill>
            ) : undefined
          }
        />
      </StaggerItem>
      {roles.includes("owner") && (
        <StaggerItem>
          <AppOverview />
        </StaggerItem>
      )}
      <StaggerItem>
        <Section title={t("avatar.title")}>
          <AvatarEditor />
        </Section>
      </StaggerItem>
      <StaggerItem>
        <Section title={t("details.title")}>
          <ProfileDetailsForm />
        </Section>
      </StaggerItem>
      <StaggerItem>
        <Section title={t("password.title")}>
          <ChangePasswordForm />
        </Section>
      </StaggerItem>
    </Stagger>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <GlowCard interactive={false} className="flex flex-col gap-5 md:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="max-w-xl">{children}</div>
    </GlowCard>
  );
}
