import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCheckDuplicates } from "./queries.js";
const checker=vi.hoisted(()=>vi.fn());
vi.mock("./duplicateReview.js",()=>({duplicateBookId:()=>"isolated-book",checkNewCandidates:checker}));
afterEach(()=>{ onlineManager.setOnline(true); checker.mockReset(); });
describe("保存前的重复检测不能被离线挂起",()=>{
  it.each([false,true])("离线时实际执行检测器，失败=%s 也立即返回调用方",async fail=>{
    const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
    let mutation: ReturnType<typeof useCheckDuplicates> | undefined;
    function Capture(){mutation=useCheckDuplicates();return null;}
    renderToStaticMarkup(<QueryClientProvider client={client}><Capture /></QueryClientProvider>);
    const local={scope:"local",history:[],pairs:[],truncated:false};
    if(fail)checker.mockRejectedValue(new Error("local detector unavailable"));else checker.mockResolvedValue(local);
    onlineManager.setOnline(false);
    try{
      const result=await Promise.race([
        mutation!.mutateAsync({kind:"expense",amountCents:1234,currency:"CNY",occurredLocalDate:"2026-10-26",occurredTime:"12:00"}).then(value=>({value}),error=>({error:String(error)})),
        new Promise<"paused"> (resolve=>setTimeout(()=>resolve("paused"),250)),
      ]);
      expect(result).not.toBe("paused");
      expect(checker).toHaveBeenCalledOnce();
      expect(client.getMutationCache().getAll()[0]?.state.isPaused).toBe(false);
      expect(result).toEqual(fail?{error:"Error: local detector unavailable"}:{value:local});
    }finally{client.clear();}
  });
});
