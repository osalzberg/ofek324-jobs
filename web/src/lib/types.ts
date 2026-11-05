export interface Viewer {
  id: string; email: string; status: "pending" | "approved" | "rejected" | "banned";
  kind: "unit_member" | "external_recruiter"; can_seek: boolean; can_post: boolean; is_admin: boolean;
  verified_name: string | null; can_recommend: boolean; created_at: Date;
}
export interface Verification {
  member_id: string; full_name: string; requested_kind: string; unit_start_year: number | null;
  unit_end_year: number | null; release_date: Date | null; already_released: boolean; linkedin_url: string;
}
export interface Job {
  id: string; creator_id: string; title: string; company: string; city: string | null;
  work_mode: string; job_type: string; seniority: string; tech_tags: string; description: string;
  salary_min: number | null; salary_max: number | null; salary_currency: string; salary_period: string;
  apply_method: "email" | "external_link" | "profile"; apply_email: string | null; apply_url: string | null;
  referral_available: boolean; is_open: boolean; available: boolean; created_at: Date; updated_at: Date;
  expires_at: Date; deleted_at: Date | null;
}
export interface Profile {
  member_id: string; full_name: string; headline: string; release_date: Date | null; already_released: boolean;
  years_experience: number; skills: string; preferred_roles: string; preferred_locations: string;
  linkedin_url: string | null; github_url: string | null; bio: string; status: string;
  cv_document_id: string | null; moderated_at: Date | null; recommendation_count: number; discoverable: boolean;
}
export interface MemberCard {
  member_id: string; full_name: string; unit_start_year: number | null; unit_end_year: number | null;
  headline: string; current_title: string; company: string; published: boolean;
}
export interface Recommendation {
  id: string; author_id: string; seeker_id: string; text: string; relationship: string | null;
  status: string; revision: number; created_at: Date; updated_at: Date;
  author_name: string | null; author_headline: string | null; author_title: string | null;
  author_company: string | null; unit_start_year: number | null; unit_end_year: number | null;
}
export interface Applicant {
  id: string; job_id: string; applicant_id: string; created_at: Date; full_name: string | null;
  headline: string | null; skills: string | null; status: string | null; recommendation_count: number | null;
}
export interface SavedSearch {
  id: string; owner_id: string; name: string; filters: string; email_enabled: boolean; next_digest_at: Date;
}
export interface Invite {
  id: string; slot: number; redeemed_by: string | null; issued_at: Date | null; redeemed_at: Date | null; revoked_at: Date | null;
}
export interface AdminMember {
  id: string; email: string; status: string; kind: string; is_admin: boolean; invited_by: string | null;
  created_at: Date; full_name: string | null; unit_start_year: number | null; unit_end_year: number | null;
  release_date: Date | null; already_released: boolean | null; linkedin_url: string | null; requested_kind: string | null;
}
export interface Stats { members: number; pending: number; active_jobs: number; applications: number; recommendations: number }
export interface CvDocument { id: string; owner_id: string; object_name: string; original_filename: string; state: string; byte_size: number }
