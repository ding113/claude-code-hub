import { getModelPrices, getModelPricesPaginated } from "@/actions/model-prices";
import { Section } from "@/components/section";
import { PriceList } from "./_components/price-list";
import { UploadPriceDialog } from "./_components/upload-price-dialog";
import { SyncLiteLLMButton } from "./_components/sync-litellm-button";
import { SettingsPageHeader } from "../_components/settings-page-header";

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
  const params = await searchParams;

  // 解析分页参数
  const page = parseInt(params.page || '1', 10);
  const pageSize = parseInt(params.pageSize || params.size || '50', 10);
  const searchTerm = params.search || '';

  // 获取分页数据
  const pricesResult = await getModelPricesPaginated({ page, pageSize });
  const isRequired = params.required === "true";

  // 如果获取分页数据失败，降级到获取所有数据
  let initialPrices = [];
  let initialTotal = 0;
  let initialPage = page;
  let initialPageSize = pageSize;

  if (pricesResult.ok) {
    initialPrices = pricesResult.data!.data;
    initialTotal = pricesResult.data!.total;
    initialPage = pricesResult.data!.page;
    initialPageSize = pricesResult.data!.pageSize;
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
      <SettingsPageHeader title="价格表" description="管理平台基础配置与模型价格" />

      <Section
        title="模型价格"
        description="管理 AI 模型的价格配置"
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
