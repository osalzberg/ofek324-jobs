import "server-only";
import { z } from "zod";
import { userDb } from "./auth";
import { type Db, TYPES, type Parameter } from "./sql";
import { type JobFilters, searchInput } from "./validation";
import type { Job, Profile, Recommendation } from "./types";

export type QueryParams = Record<string, string | string[] | undefined>;
export const scalar = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export function jobFilters(params: QueryParams): JobFilters {
  return searchInput.parse(Object.fromEntries(Object.keys(searchInput.shape).map(key => [key, scalar(params[key]) ?? ""])));
}
export function pageNumber(params: QueryParams) {
  return z.coerce.number().int().min(1).max(1000).parse(scalar(params.page) ?? "1");
}
export async function jobs(db: Db, filters: JobFilters, page = 1): Promise<Job[]> {
  const params: Parameter[] = [
    ["tags", TYPES.NVarChar, JSON.stringify(filters.tags.split(",").map(s => s.trim().toLowerCase()).filter(Boolean))],
    ["city", TYPES.NVarChar, filters.city], ["work", TYPES.VarChar, filters.work_mode],
    ["type", TYPES.VarChar, filters.job_type], ["seniority", TYPES.VarChar, filters.seniority],
    ["referral", TYPES.Bit, filters.referral === "1"], ["days", TYPES.Int, filters.days ? Number(filters.days) : null],
    ["offset", TYPES.Int, (page - 1) * 24],
  ];
  if (filters.query) params.push(["query", TYPES.NVarChar, filters.query]);
  return db.query<Job>(`SELECT j.* FROM app.job_cards j WHERE j.available=1
    ${filters.query ? "AND j.id IN(SELECT id FROM app.jobs WHERE FREETEXT((title,company,description),@query,LANGUAGE 0))" : ""}
    AND (@city=N'' OR j.city=@city) AND (@work='' OR j.work_mode=@work)
    AND (@type='' OR j.job_type=@type) AND (@seniority='' OR j.seniority=@seniority)
    AND (@referral=0 OR j.referral_available=1)
    AND (@days IS NULL OR j.created_at>=DATEADD(day,-@days,SYSUTCDATETIME()))
    AND NOT EXISTS(SELECT 1 FROM OPENJSON(@tags) f WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(j.tech_tags) t WHERE t.value=f.value))
    ORDER BY j.created_at DESC,j.id OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;`, params);
}
export async function profiles(params: QueryParams): Promise<Profile[]> {
  const schema = z.object({
    skills: z.string().max(1000), status: z.enum(["", "actively_looking", "open_to_offers"]),
    months: z.enum(["", "3", "6", "12"]), experience: z.enum(["", "0", "2", "5", "10"]), recommended: z.enum(["", "1"]),
  });
  const f = schema.parse(Object.fromEntries(Object.keys(schema.shape).map(key => [key, scalar(params[key]) ?? ""])));
  return userDb(db => db.query<Profile>(`SELECT p.* FROM app.profile_cards p WHERE p.discoverable=1
    AND (@status='' OR p.status=@status) AND (@years IS NULL OR p.years_experience>=@years)
    AND (@months IS NULL OR (p.already_released=0 AND p.release_date>=CONVERT(date,SYSUTCDATETIME()) AND p.release_date<=DATEADD(month,@months,CONVERT(date,SYSUTCDATETIME()))))
    AND (@recommended=0 OR p.recommendation_count>0)
    AND NOT EXISTS(SELECT 1 FROM OPENJSON(@skills) f WHERE NOT EXISTS(SELECT 1 FROM OPENJSON(p.skills) s WHERE s.value=f.value))
    ORDER BY p.updated_at DESC,p.member_id OFFSET @offset ROWS FETCH NEXT 24 ROWS ONLY;`, [
    ["status", TYPES.VarChar, f.status], ["years", TYPES.Int, f.experience ? Number(f.experience) : null],
    ["months", TYPES.Int, f.months ? Number(f.months) : null], ["recommended", TYPES.Bit, f.recommended === "1"],
    ["skills", TYPES.NVarChar, JSON.stringify(f.skills.split(",").map(s => s.trim().toLowerCase()).filter(Boolean))],
    ["offset", TYPES.Int, (pageNumber(params) - 1) * 24],
  ]));
}
export function recommendations(db: Db, member: string, given = false) {
  return db.query<Recommendation>(`SELECT r.*,c.full_name AS author_name,c.headline AS author_headline,
    c.current_title AS author_title,c.company AS author_company,c.unit_start_year,c.unit_end_year
    FROM app.recommendations r LEFT JOIN app.member_cards c ON c.member_id=r.author_id
    WHERE ${given ? "r.author_id" : "r.seeker_id"}=@member ORDER BY r.created_at DESC;`, [["member", TYPES.UniqueIdentifier, member]]);
}
