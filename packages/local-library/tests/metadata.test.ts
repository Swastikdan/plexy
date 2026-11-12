import {expect,test} from "bun:test";
import {fetchMetadata, type MetadataIO} from "../src/metadata";
import type {LocalRecord} from "../src/library";
function record(tv=false):LocalRecord {return {id:1,root:"file:///videos",file:{uri:"file:///videos/test.mkv",name:"Example.S01E02.mkv",relativePath:tv ? "Example/Season 01/Example.S01E02.mkv" : "Example.2024.mkv",size:100,modified:1},metadataAt:0,cast:[],card:{id:1,publicId:"local-1",kind:tv ? "episode" : "movie",name:"Example",parentId:tv ? 2 : null,parentTitle:tv ? "Example" : null,year:2024,seasonNumber:tv ? 1 : null,episodeNumber:tv ? 2 : null,fileId:1,poster:null,backdrop:null,overview:null,rating:null,runtime:null,genres:[],matchStatus:"unmatched",watch:null}};}
function fixture() {
 const paths:string[]=[];
 const images:string[]=[];
 const io:MetadataIO={request:async path=>{
  paths.push(path);
  if(path.startsWith("/search")) return {results:[{id:42,name:"Example",title:"Example"}]};
  if(path.includes("/season/")) return {poster_path:"/season.jpg",episodes:[{episode_number:2,name:"Episode Two",overview:"Episode synopsis",still_path:"/still.jpg",runtime:45,vote_average:8.2}]};
  return {id:42,name:"Example",title:"Example",poster_path:"/poster.jpg",backdrop_path:"/backdrop.jpg",overview:"Series synopsis",vote_average:8,release_date:"2024-01-01",runtime:120,tagline:"A tagline",genres:[{name:"Drama"}],seasons:[{id:9,season_number:1,name:"Season One",poster_path:"/season.jpg"}],images:{logos:[{iso_639_1:"en",file_path:"/logo.png"}]},credits:{cast:[{name:"Actor",character:"Role",profile_path:"/actor.jpg"}]},videos:{results:[{site:"YouTube",type:"Trailer",official:true,key:"trailer-key",name:"Trailer"}]},release_dates:{results:[{iso_3166_1:"US",release_dates:[{certification:"PG-13"}]}]}};
 },artwork:async(path,size)=>{if(!path)return null;images.push(`${size}${path}`);return `file:///art/${size}${path}`;}};
 return {io,paths,images};
}
test("movie hydration includes all displayed artwork, credits, trailer and detail fields",async()=>{
 const f=fixture();const result=await fetchMetadata(record(),f.io);
 expect(result.card?.poster).toContain("w780/poster.jpg");expect(result.card?.backdrop).toContain("w1280/backdrop.jpg");
 expect(result.cast?.[0]?.photo).toContain("h632/actor.jpg");expect(result.logo).toContain("logo.png");
 expect(result.trailer?.key).toBe("trailer-key");expect(result.tagline).toBe("A tagline");expect(result.certification).toBe("PG-13");
 expect(result.metadataVersion).toBe(2);expect(result.metadataAt).toBeGreaterThan(0);
});
test("episode stills and season posters stay separate from the series artwork",async()=>{
 const f=fixture();const result=await fetchMetadata(record(true),f.io);
 expect(result.card?.poster).toContain("still.jpg");expect(result.card?.name).toBe("Episode Two");
 expect(result.seriesMetadata?.poster).toContain("poster.jpg");expect(result.seriesMetadata?.overview).toBe("Series synopsis");
 expect(result.seasons?.[0]?.poster).toContain("season.jpg");expect(result.seasons?.[0]?.name).toBe("Season One");
});
test("failed artwork retains text and schedules a retry rather than discarding metadata",async()=>{
 const f=fixture();f.io.artwork=async()=>{throw Error("offline");};
 const result=await fetchMetadata(record(),f.io);
 expect(result.card?.name).toBe("Example");expect(result.card?.matchStatus).toBe("matched");expect(result.metadataAt).toBe(0);
});
test("ambiguous filenames require manual selection; explicit selection bypasses search",async()=>{
 const f=fixture();const request=f.io.request;
 f.io.request=async p=>p.startsWith("/search")?{results:[{id:1,title:"Example"},{id:2,title:"Example"}]}:request(p);
 const unmatched=await fetchMetadata(record(),f.io);expect(unmatched.card?.matchStatus).toBe("review");expect(unmatched.tmdbId).toBeUndefined();
 const selected=record();selected.tmdbId=42;selected.manualIdentity=true;
 const result=await fetchMetadata(selected,f.io);expect(result.tmdbId).toBe(42);expect(f.paths.some(p=>p.startsWith("/movie/42"))).toBe(true);
});

test("metadata settings reach title and season requests, poster downloads and regional ratings",async()=>{
 const f=fixture(); const original=f.io.request;
 f.io.settings={language:"hi-IN",region:"IN",posterSize:"w500"};
 f.io.request=async path=>{const data=await original(path); if(!path.startsWith("/search") && !path.includes("/season/")) data.content_ratings={results:[{iso_3166_1:"IN",rating:"U/A"}]}; return data;};
 const result=await fetchMetadata(record(true),f.io);
 expect(f.paths.every(path=>path.includes("language=hi-IN") && path.includes("region=IN"))).toBe(true);
 expect(result.seriesMetadata?.poster).toContain("w500/poster.jpg"); expect(result.certification).toBe("U/A");
});

test("caches collection membership and key crew for local discovery", async () => {
 const f = fixture();
 const request = f.io.request;
 f.io.request = async path => {
  const data = await request(path);
  if (!path.startsWith("/search")) {
   data.belongs_to_collection = { id: 99, name: "Example Collection" };
   data.credits.crew = [{ name: "Director", job: "Director", profile_path: null }];
  }
  return data;
 };
 const result = await fetchMetadata(record(), f.io);
 expect(result.collection).toEqual({ id: 99, name: "Example Collection" });
 expect(result.cast?.find(p => p.name === "Director")?.character).toBe("Director");
});
