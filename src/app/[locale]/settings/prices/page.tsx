import { getTranslations } from "next-intl/server";
import { getModelPrices, getModelPricesPaginated } from "@/actions/model-prices";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { PriceList } from "./_components/price-list";
import { SyncLiteLLMButton } from "./_components/sync-litellm-button";
import { UploadPriceDialog } from "./_components/upload-price-dialog";

export const dynamic = "force-dynamic";

interface SettingsPricesPageProps {
  searchParams: Promise<{
    required?: string;
    page?: string;
    pageSize?: string;
    size?: string;
    search?: string;
  }>;
}

export default async function SettingsPricesPage({ searchParams }: SettingsPricesPageProps) {
  const t = await getTranslations("settings");
  const params = await searchParams;

  // 解析分页参数
  const page = parseInt(params.page || "1", 10);
  const pageSize = parseInt(params.pageSize || params.size || "50", 10);

  // 获取分页数据（搜索在客户端处理）
  const pricesResult = await getModelPricesPaginated({ page, pageSize });
  const isRequired = params.required === "true";

  // 如果获取分页数据失败，降级到获取所有数据
  let initialPrices = [];
  let initialTotal = 0;
  let initialPage = page;
  let initialPageSize = pageSize;

  if (pricesResult.ok) {
    initialPrices = pricesResult.data?.data;
    initialTotal = pricesResult.data?.total;
    initialPage = pricesResult.data?.page;
    initialPageSize = pricesResult.data?.pageSize;
  } else {
    // 降级处理：获取所有数据
    const allPrices = await getModelPrices();
    initialPrices = allPrices;
    initialTotal = allPrices.length;
    initialPage = 1;
    initialPageSize = allPrices.length; // 显示所有数据
  }

  const isEmpty = initialTotal === 0;

  return (
    <>
      <SettingsPageHeader title={t("prices.title")} description={t("prices.description")} />

      <Section
        title={t("prices.section.title")}
        description={t("prices.section.description")}
        actions={
          <div className="flex gap-2">
            <SyncLiteLLMButton />
            <UploadPriceDialog defaultOpen={isRequired && isEmpty} isRequired={isRequired} />
          </div>
        }
      >
        <PriceList
          initialPrices={initialPrices}
          initialTotal={initialTotal}
          initialPage={initialPage}
          initialPageSize={initialPageSize}
        />
      </Section>
    </>
  );
}
