"use client";

import { LogIn } from "lucide-react";
import Link from "next/link";

import { PrimaryButton } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";
import { aiLoginRequiredMessage } from "@/lib/ai-client";
import { loginHrefFor } from "@/lib/navigation";

type AiLoginNoticeProps = {
  returnPath: string;
  description: string;
  className?: string;
  onBeforeNavigate?: () => void;
};

export function AiLoginNotice({
  returnPath,
  description,
  className = "mt-0",
  onBeforeNavigate,
}: AiLoginNoticeProps) {
  return (
    <StateMessage
      className={className}
      title={aiLoginRequiredMessage}
      action={
        <PrimaryButton asChild size="md">
          <Link href={loginHrefFor(returnPath)} onClick={onBeforeNavigate}>
            <LogIn aria-hidden="true" className="h-4 w-4" />
            Iniciar sesión
          </Link>
        </PrimaryButton>
      }
    >
      <p>{description}</p>
    </StateMessage>
  );
}
