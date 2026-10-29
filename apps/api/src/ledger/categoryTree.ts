import { validateCategoryTree } from "@libellum/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, forbidden } from "../lib/errors.js";

export async function lockCategoryTree(tx: Prisma.TransactionClient, bookId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM books WHERE id=${bookId}::uuid FOR UPDATE`;
}
/** 结构性提交在等待账本锁后再次核对成员身份，新增检查不替代既有 guard。 */
export async function checkCategoryWriter(tx: Prisma.TransactionClient, bookId: string, userId: string): Promise<void> {
  const membership=await tx.bookMember.findUnique({where:{bookId_userId:{bookId,userId}}});
  if(!membership||membership.leftAt!==null||(membership.role!=="owner"&&membership.role!=="editor"))throw forbidden("category_tree_permission","分类管理权限已变化，请重新打开账本。");
}
export async function checkCategoryTree(tx: Prisma.TransactionClient, bookId: string, change: { id: string; parentId?: string | null; name?: string; kind?: "income" | "expense"; isSystem?: boolean }): Promise<void> {
  const nodes = await tx.category.findMany({where:{bookId}});
  const current = nodes.find(n=>n.id===change.id);
  const next = current ? {...current,...change} : {name:"",kind:"expense",...change};
  try { validateCategoryTree([...nodes.filter(n=>n.id!==change.id),next]); }
  catch (error) { if(error instanceof Error && error.message === "category_exists") throw conflict("category_exists","同级下已经有同名分类了。"); throw badRequest("category_tree_invalid", "所属分类无效、层级过深或存在循环，请重新选择。"); }
}
