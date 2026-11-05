import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { jobInput, profileInput, searchInput, verificationInput } from "../src/lib/validation";
import { MAX_CV_BYTES, validatePdf } from "../src/lib/pdf";
const job = { title: "Test developer", company: "Demo", city: "", work_mode: "remote", job_type: "full_time",
  seniority: "junior", tech_tags: "React, Python", description: "Synthetic development job for validation only.",
  salary_min: "", salary_max: "", salary_currency: "ILS", salary_period: "month", apply_method: "profile",
  apply_email: "", apply_url: "", referral_available: "on" };
test("job tags and checkbox normalize; unused apply details are cleared", () => {
  const parsed = jobInput.parse({ ...job, apply_email: "EXAMPLE@example.invalid" });
  assert.deepEqual(parsed.tech_tags, ["react", "python"]); assert.equal(parsed.referral_available, true);
  assert.equal(parsed.apply_email, null);
});
test("onsite jobs need a city and salary ranges cannot be reversed", () => {
  assert.equal(jobInput.safeParse({ ...job, work_mode: "onsite" }).success, false);
  assert.equal(jobInput.safeParse({ ...job, salary_min: "200", salary_max: "100" }).success, false);
});
test("application links reject script schemes and require a destination", () => {
  assert.equal(jobInput.safeParse({ ...job, apply_method: "external_link", apply_url: "javascript:alert(1)" }).success, false);
  assert.equal(jobInput.safeParse({ ...job, apply_method: "external_link" }).success, false);
});
test("external verification cannot claim unit service or recommendation eligibility", () => {
  const parsed = verificationInput.parse({ full_name: "Test recruiter", requested_kind: "external_recruiter",
    unit_start_year: "2010", unit_end_year: "2020", already_released: "on", release_date: "2020-01-01",
    linkedin_url: "https://www.linkedin.com/in/synthetic-test" });
  assert.equal(parsed.already_released, false); assert.equal(parsed.unit_start_year, null);
});
test("profiles require a release status and search values are allowlisted", () => {
  assert.equal(profileInput.safeParse({ full_name: "Test", headline: "Developer", skills: "", preferred_roles: "",
    preferred_locations: "", bio: "", status: "hidden", years_experience: "0" }).success, false);
  assert.equal(searchInput.safeParse({ days: "-1" }).success, false);
});
async function pdf() { const doc = await PDFDocument.create(); doc.addPage(); return doc; }
test("ordinary PDFs pass, fake and oversized PDFs fail", async () => {
  await validatePdf(await (await pdf()).save());
  await assert.rejects(validatePdf(Buffer.from("%PDF-1.7 fake content with %%EOF")));
  await assert.rejects(validatePdf(new Uint8Array(MAX_CV_BYTES + 1)));
});
test("nested inline JavaScript dictionaries are rejected", async () => {
  const doc = await pdf();
  doc.catalog.set(PDFName.of("Nested"), doc.context.obj([{ More: { JS: "alert(1)" } }]));
  await assert.rejects(validatePdf(await doc.save()), /תוכן פעיל/);
});
test("stream dictionaries with launch actions are rejected", async () => {
  const doc = await pdf();
  doc.catalog.set(PDFName.of("Nested"), doc.context.register(doc.context.stream("test", { S: "Launch" })));
  await assert.rejects(validatePdf(await doc.save()), /תוכן פעיל/);
});
