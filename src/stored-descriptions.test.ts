import {afterEach,expect,test,vi} from "vitest";
import {defineProgram,h,mountIslands,mountProgram,reply,type ProgramSubscription} from "./program.js";
import {createWebMCP,createWebMCPCaller,exposeMessages,parseWebMCPDescriptions,parseWebMCPDescriptionPackets,type WebMCPDescriptions,type WebMCPDescriptionPacket,type WebMCPRegisteredTool} from "./webmcp.js";

const stops:Array<()=>void>=[];
afterEach(()=> {for(const stop of stops.splice(0))stop();document.body.replaceChildren();Reflect.deleteProperty(document,"modelContext");vi.unstubAllGlobals();vi.restoreAllMocks();});
const packet=(description="Stored English",language:"en"|"fr"="en"):WebMCPDescriptionPacket=>({scope:"ExampleApp",language,binding:"signed-render",tools:{read:{key:"tool:ExampleApp/read",description}}});
const tools=exposeMessages<{type:"read"}>([{message:"read"}],{read:{type:"object",properties:{},required:[],additionalProperties:false}});
function mount(descriptions?:WebMCPDescriptionPacket) {
 const bridge=createWebMCP<{type:"read"}>({onRegistrationError:()=>{throw Error("unexpected registration failure");}});
 const node=document.createElement("output");document.body.append(node);
 const program=defineProgram<undefined,number,{type:"read"},never>({init:()=>[0,[]],update:model=>[model+1,[reply("read")]],view:()=>h("output",{},"Human page"),subscriptions:()=>[bridge.subscription(tools)]});
 const handle=mountProgram({node,flags:undefined,program,...(descriptions===undefined?{}:{toolDescriptions:[descriptions]})});stops.push(handle.stop);return handle;
}
test.each(["en","fr"]as const)("%s native, fallback and built-in tools share stored text and identity",async language=>{
 const native=new Map<string,WebMCPRegisteredTool>();
 Object.assign(document,{modelContext:{registerTool:(tool:WebMCPRegisteredTool,{signal}:{signal:AbortSignal})=>{native.set(tool.name,tool);signal.addEventListener("abort",()=>native.delete(tool.name));return Promise.resolve();}}});
 const text=language==="en"?"Stored English":"Français enregistré";const handle=mount(packet(text,language));await handle.settle();
 const caller=createWebMCPCaller(document);stops.push(caller.stop);const builtin=await caller.captureReady();
 expect(native.get("read")?.description).toBe(text);expect(window.hyperteaAgent?.getTools()[0]?.description).toBe(text);
 expect(builtin.getTools()[0]).toMatchObject({description:text,key:"tool:ExampleApp/read",scope:"ExampleApp",binding:"signed-render"});
 expect(await builtin.executeTool("read",{})).toBe("read");expect(handle.model()).toBe(1);
});
test("missing and blank descriptions never register tools or prevent human rendering",async()=>{
 const error=vi.spyOn(console,"error").mockImplementation(()=>undefined);
 const missing=mount();await missing.settle();expect(document.body.textContent).toContain("Human page");expect(window.hyperteaAgent).toBeUndefined();missing.stop();
 const empty=mount(packet(" "));await empty.settle();expect(window.hyperteaAgent).toBeUndefined();empty.stop();
 expect(error).toHaveBeenNthCalledWith(1,"Missing WebMCP description: unbound/read");expect(error).toHaveBeenNthCalledWith(2,"Missing WebMCP description: ExampleApp/read");
});
test("one missing description leaves the other tools usable",async()=>{
 const error=vi.spyOn(console,"error").mockImplementation(()=>undefined);const bridge=createWebMCP<{type:"read"}>({onRegistrationError:()=>{throw Error("must not disable the valid tool");}});
 const subscription=bridge.subscription([...tools,...tools.map(tool=>({...tool,name:"missing"}))]);
 stops.push(subscription.subscribe(()=>undefined,{toolDescriptions:[packet()],call:()=>Promise.resolve("available")}));
 const caller=createWebMCPCaller(document);stops.push(caller.stop);const ready=await caller.captureReady();expect(ready.getTools().map(tool=>tool.name)).toEqual(["read"]);expect(await ready.executeTool("read",{})).toBe("available");
 expect(error).toHaveBeenCalledWith("Missing WebMCP description: ExampleApp/missing");
});
test("a refreshed mount replaces text and retires the captured publication",async()=>{
 const first=mount(packet());await first.settle();const caller=createWebMCPCaller(document);stops.push(caller.stop);const captured=await caller.captureReady();first.stop();
 const second=mount(packet("Edited after navigation"));await second.settle();const current=await caller.captureReady();expect(current.getTools()[0]?.description).toBe("Edited after navigation");
 await expect(captured.executeTool("read",{})).rejects.toMatchObject({outcome:"cancelled-before-dispatch"});
});
test("packet validation rejects malformed and oversized discovery data",()=>{
 const good=packet();expect(parseWebMCPDescriptions(good)).toEqual(good);
 const invalid:Array<unknown>=[undefined,null,[],1,()=>undefined,{}, {...good,scope:1},{...good,scope:""},{...good,scope:"x".repeat(513)},{...good,language:"de"},{...good,binding:1},{...good,binding:""},{...good,binding:"x".repeat(8193)},
 {...good,tools:null},{...good,tools:[]},{...good,tools:1},{...good,tools:Object.fromEntries(Array.from({length:65},(_,i)=>[String(i),{key:"key",description:"text"}]))},
 ...["","x".repeat(129)].map(name=>({...good,tools:{[name]:{key:"key",description:"text"}}})),
 ...[null,[],1,{key:1,description:"text"},{key:"",description:"text"},{key:"x".repeat(513),description:"text"},{key:"key",description:1},{key:"key",description:" "},{key:"key",description:"x".repeat(12289)}].map(value=>({...good,tools:{read:value}}))];
 for(const value of invalid)expect(()=>parseWebMCPDescriptions(value)).toThrow("Invalid WebMCP description packet");
 const special=JSON.parse('{"scope":"ExampleApp","language":"en","binding":"signed","tools":{"__proto__":{"key":"tool:ExampleApp/__proto__","description":"Stored prototype name"}}}')as unknown;
 expect(Object.keys(parseWebMCPDescriptions(special).tools)).toEqual(["__proto__"]);
});
test.each([undefined,"not JSON","{}",JSON.stringify([packet()])])("island host carries %s separately from flags and preserves human rendering",async value=>{
 const error=vi.spyOn(console,"error").mockImplementation(()=>undefined);const node=document.createElement("div");node.dataset.example="";node.dataset.flags='{"label":"Human page"}';if(value!==undefined)node.dataset.toolDescriptions=value;document.body.append(node);
 const contexts:Array<WebMCPDescriptions|undefined>=[];
 const program=defineProgram<{label:string},string,{type:"read"},never>({init:flags=>[flags.label,[]],update:model=>[model,[]],view:model=>h("div",{},model),subscriptions:(_model,context)=>{contexts.push(context.toolDescriptions);return[{key:"discovery",subscribe:(_dispatch,subscription)=>{contexts.push(subscription.toolDescriptions);return()=>undefined;}}]satisfies ReadonlyArray<ProgramSubscription<{type:"read"}>>;}});
 mountIslands({selector:"[data-example]",parseFlags:value=>value as {label:string},program});await vi.waitFor(()=>{expect(document.body.textContent).toBe("Human page");});
 if(value===JSON.stringify([packet()]))expect(contexts).toEqual([[packet()],[packet()]]);else expect(contexts).toEqual([undefined,undefined]);
 expect(error).toHaveBeenCalledTimes(value!==undefined&&value!==JSON.stringify([packet()])?1:0);
});

test("composed packets validate as a bounded collection",()=>{
 expect(parseWebMCPDescriptionPackets([packet()])).toEqual([packet()]);
 expect(parseWebMCPDescriptionPackets([])).toEqual([]);
 for(const value of [null,{},Array.from({length:17},()=>packet()),[{}]])expect(()=>parseWebMCPDescriptionPackets(value)).toThrow(/Invalid WebMCP description packet/);
});
test("ambiguous descriptions refuse only that tool",()=>{
 const error=vi.spyOn(console,"error").mockImplementation(()=>undefined);const bridge=createWebMCP<{type:"read"}>({onRegistrationError:()=>{throw Error("not a registration error");}});
 const stop=bridge.subscription(tools).subscribe(()=>undefined,{toolDescriptions:[packet(),{...packet(),scope:"OtherApp"}],call:()=>Promise.resolve("unexpected")});stops.push(stop);
 expect(window.hyperteaAgent).toBeUndefined();expect(error).toHaveBeenCalledWith("Missing WebMCP description: ExampleApp/read");
});

test("a refreshed server packet overrides the mount packet without a prose fallback",async()=>{
 const error=vi.spyOn(console,"error").mockImplementation(()=>undefined);const bridge=createWebMCP<{type:"read"}>({onRegistrationError:()=>{throw Error("unexpected failure");}});
 const context={toolDescriptions:[packet("Old mount text")],call:()=>Promise.resolve("read")};
 const first=bridge.subscription(tools,{toolDescriptions:[packet("Fresh document text")]});const stop=first.subscribe(()=>undefined,context);
 expect(window.hyperteaAgent?.getTools()[0]?.description).toBe("Fresh document text");const caller=createWebMCPCaller(document);stops.push(caller.stop);const captured=await caller.captureReady();stop();
 const invalid=bridge.subscription(tools,{toolDescriptions:{private:"not a packet"}}).subscribe(()=>undefined,context);stops.push(invalid);
 expect(window.hyperteaAgent).toBeUndefined();expect(error).toHaveBeenCalledWith("Invalid WebMCP description packets");
 await expect(captured.executeTool("read",{})).rejects.toMatchObject({outcome:"cancelled-before-dispatch"});
});
