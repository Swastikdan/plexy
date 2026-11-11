import {expect,test} from "bun:test";
import {resourceKey} from "../src/resource-key";
test("home and search resources cannot share differently shaped payloads",()=>{
 const api={};
 expect(resourceKey("search-results",[api,""])).not.toBe(resourceKey("search-home",[api,""]));
 expect(resourceKey("home-instance",[api])).not.toBe(resourceKey("status-instance",[api]));
});
test("resource keys preserve session identity, primitive types and separators",()=>{
 const a={},b={};
 expect(resourceKey("home",[a])).not.toBe(resourceKey("home",[b]));
 expect(resourceKey("detail",[a,1])).not.toBe(resourceKey("detail",[a,"1"]));
 expect(resourceKey("search",["a:b","c"])).not.toBe(resourceKey("search",["a","b:c"]));
 expect(resourceKey("home",[a])).toBe(resourceKey("home",[a]));
});
