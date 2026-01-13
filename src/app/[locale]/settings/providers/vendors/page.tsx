import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { VendorsManagerLoader } from "../_components/vendors/vendors-manager-loader";

export default async function VendorsPage() {
  const t = await getTranslations("settings.providers.vendors");

  return (
    <Section title={t("title")} description={t("description")}>
      <VendorsManagerLoader />
    </Section>
  );
}
