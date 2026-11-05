import "server-only";
import { BlobServiceClient, BlobSASPermissions, SASProtocol, generateBlobSASQueryParameters } from "@azure/storage-blob";
import { credential } from "./credential";
import { config } from "./config";
const service = new BlobServiceClient(`https://${config.storage}.blob.core.windows.net`, credential);
const container = service.getContainerClient("cvs");
function validPath(path: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(path)) throw new Error("Invalid private document path");
}
export async function uploadCv(path: string, bytes: Buffer) {
  validPath(path);
  await container.getBlockBlobClient(path).uploadData(bytes, {
    conditions: { ifNoneMatch: "*" },
    blobHTTPHeaders: { blobContentType: "application/pdf", blobContentDisposition: 'attachment; filename="cv.pdf"', blobCacheControl: "private, no-store" },
  });
}
export async function deleteCv(path: string) {
  validPath(path);
  await container.getBlockBlobClient(path).deleteIfExists();
}
export async function signedCv(path: string) {
  validPath(path);
  const now = new Date();
  const expiresOn = new Date(now.getTime() + 60000);
  const startsOn = new Date(now.getTime() - 300000);
  const key = await service.getUserDelegationKey(startsOn, expiresOn);
  const sas = generateBlobSASQueryParameters({ containerName: "cvs", blobName: path,
    permissions: BlobSASPermissions.parse("r"), protocol: SASProtocol.Https, expiresOn,
    contentDisposition: 'attachment; filename="cv.pdf"', cacheControl: "private, no-store",
  }, key, config.storage).toString();
  return `${container.getBlobClient(path).url}?${sas}`;
}
