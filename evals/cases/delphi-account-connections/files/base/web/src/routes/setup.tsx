import { createFileRoute } from "@tanstack/react-router";
import { DoctorSection } from "@/setup/DoctorSection";
import { ModelSetupSection } from "@/setup/ModelSetupSection";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="font-semibold text-lg">Setup</h1>
      <ModelSetupSection />
      <DoctorSection />
    </div>
  );
}
