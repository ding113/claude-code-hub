"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Info, ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { useState } from "react";

interface ScenarioStep {
  step: string;
  description: string;
  example: {
    before: string;
    after: string;
    decision: string;
  };
}

const scenarios: Array<{
  title: string;
  emoji: string;
  description: string;
  steps: ScenarioStep[];
}> = [
  {
    title: "优先级分层选择",
    emoji: "🎯",
    description: "系统首先按优先级过滤，只从最高优先级的供应商中选择",
    steps: [
      {
        step: "初始状态",
        description: "有 4 个已启用的供应商，优先级各不相同",
        example: {
          before: "供应商 A (优先级 0), B (优先级 1), C (优先级 0), D (优先级 2)",
          after: "筛选出最高优先级（0）的供应商：A, C",
          decision: "只从 A 和 C 中选择，B 和 D 被过滤",
        },
      },
      {
        step: "成本排序",
        description: "在同优先级内，按成本倍率从低到高排序",
        example: {
          before: "A (成本 1.0x), C (成本 0.8x)",
          after: "排序后：C (0.8x), A (1.0x)",
          decision: "成本更低的 C 有更高的被选中概率",
        },
      },
      {
        step: "加权随机",
        description: "使用权重进行随机选择，权重越高被选中概率越大",
        example: {
          before: "C (权重 3), A (权重 1)",
          after: "C 被选中概率 75%, A 被选中概率 25%",
          decision: "最终随机选择了 C",
        },
      },
    ],
  },
  {
    title: "用户分组过滤",
    emoji: "👥",
    description: "如果用户指定了供应商组，系统会优先从该组中选择",
    steps: [
      {
        step: "检查用户分组",
        description: "用户配置了 providerGroup = 'premium'",
        example: {
          before: "所有供应商：A (default), B (premium), C (premium), D (economy)",
          after: "过滤出 'premium' 组：B, C",
          decision: "只从 B 和 C 中选择",
        },
      },
      {
        step: "分组降级",
        description: "如果用户组内没有可用供应商，降级到所有供应商",
        example: {
          before: "用户组 'vip' 内的供应商全部禁用或超限",
          after: "降级到所有启用的供应商：A, B, C, D",
          decision: "记录警告并从全局供应商池中选择",
        },
      },
    ],
  },
  {
    title: "健康度过滤（熔断器 + 限流）",
    emoji: "🛡️",
    description: "系统自动过滤掉熔断或超限的供应商",
    steps: [
      {
        step: "熔断器检查",
        description: "连续失败 5 次后熔断器打开，60 秒内不可用",
        example: {
          before: "供应商 A 连续失败 5 次，熔断器状态：open",
          after: "A 被过滤，剩余：B, C, D",
          decision: "A 在 60 秒后自动恢复到半开状态",
        },
      },
      {
        step: "金额限流",
        description: "检查 5 小时、7 天、30 天的消费额度是否超限",
        example: {
          before: "供应商 B 的 5 小时限额 $10，已消耗 $9.8",
          after: "B 被过滤（接近限额），剩余：C, D",
          decision: "5 小时窗口滑动后自动恢复",
        },
      },
      {
        step: "并发 Session 限制",
        description: "检查当前活跃 Session 数是否超过配置的并发限制",
        example: {
          before: "供应商 C 并发限制 2，当前活跃 Session 数：2",
          after: "C 被过滤（已满），剩余：D",
          decision: "Session 过期（5 分钟）后自动释放",
        },
      },
    ],
  },
  {
    title: "会话复用机制",
    emoji: "🔄",
    description: "连续对话优先使用同一供应商，利用 Claude 的上下文缓存",
    steps: [
      {
        step: "检查历史请求",
        description: "查询该 API Key 最近 10 秒内使用的供应商",
        example: {
          before: "最近一次请求使用了供应商 B",
          after: "检查 B 是否启用且健康",
          decision: "B 可用，直接复用，跳过随机选择",
        },
      },
      {
        step: "复用失效",
        description: "如果上次使用的供应商不可用，则重新选择",
        example: {
          before: "上次使用的供应商 B 已被禁用或熔断",
          after: "进入正常选择流程",
          decision: "从其他可用供应商中选择",
        },
      },
    ],
  },
];

function ScenarioCard({ title, emoji, description, steps }: (typeof scenarios)[0]) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{emoji}</span>
            <div className="text-left">
              <h3 className="font-semibold text-base">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="border-l-2 border-primary/30 pl-4 space-y-2">
              <div className="flex items-baseline gap-2">
                <Badge variant="outline" className="shrink-0">
                  步骤 {index + 1}
                </Badge>
                <span className="font-medium text-sm">{step.step}</span>
              </div>
              <p className="text-sm text-muted-foreground">{step.description}</p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
                <div>
                  <span className="font-medium">过滤前：</span>
                  <span className="text-muted-foreground"> {step.example.before}</span>
                </div>
                <div>
                  <span className="font-medium">过滤后：</span>
                  <span className="text-muted-foreground"> {step.example.after}</span>
                </div>
                <div className="pt-1 border-t border-border/50">
                  <span className="font-medium text-primary">决策：</span>
                  <span className="text-foreground"> {step.example.decision}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SchedulingRulesDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="h-4 w-4" />
          调度规则说明
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Lightbulb className="h-5 w-5 text-primary" />
            供应商调度规则说明
          </DialogTitle>
          <DialogDescription>
            了解系统如何智能选择上游供应商，确保高可用性和成本优化
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>核心原则</AlertTitle>
            <AlertDescription className="space-y-1 text-sm">
              <p>
                1️⃣ <strong>优先级优先</strong>：只从最高优先级（数值最小）的供应商中选择
              </p>
              <p>
                2️⃣ <strong>成本优化</strong>：同优先级内，成本倍率低的供应商有更高概率
              </p>
              <p>
                3️⃣ <strong>健康过滤</strong>：自动跳过熔断或超限的供应商
              </p>
              <p>
                4️⃣ <strong>会话复用</strong>：连续对话复用同一供应商，节省上下文成本
              </p>
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground">交互式场景演示</h3>
            {scenarios.map((scenario, index) => (
              <ScenarioCard key={index} {...scenario} />
            ))}
          </div>

          <Alert variant="default" className="bg-primary/5 border-primary/20">
            <Lightbulb className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">最佳实践建议</AlertTitle>
            <AlertDescription className="space-y-1 text-sm text-foreground">
              <p>
                • <strong>优先级设置</strong>：核心供应商设为 0，备用供应商设为 1-3
              </p>
              <p>
                • <strong>权重配置</strong>：根据供应商容量设置权重（容量大 = 权重高）
              </p>
              <p>
                • <strong>成本倍率</strong>：官方倍率为 1.0，自建服务可设置为 0.8-1.2
              </p>
              <p>
                • <strong>限额设置</strong>：根据预算设置 5 小时、7 天、30 天限额
              </p>
              <p>
                • <strong>并发控制</strong>：根据供应商 API 限制设置 Session 并发数
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  );
}
