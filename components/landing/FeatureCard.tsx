import { ReactNode } from "react";

import { Card } from "@/design-system/ui/Card";
import { Stack } from "@/design-system/ui/Stack";

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export default function FeatureCard({
  icon,
  title,
  description,
}: FeatureCardProps) {
  return (
    <Card>
      <Stack space="md">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0F5C88]/10 text-[#0F5C88]">
          {icon}
        </div>

        <div>
          <h3 className="text-xl font-semibold text-slate-900">
            {title}
          </h3>

          <p className="mt-3 leading-7 text-slate-600">
            {description}
          </p>
        </div>
      </Stack>
    </Card>
  );
}