import { categoryBranchIds, type Category, type Transaction } from "@libellum/shared";
import { ALL_MONTHS, isAllMonths } from "./datetime.js";

export interface DetailFilters {
  month: string; from: string; to: string;
  categories: string[]; branches: string[]; tags: string[]; payments: string[]; currencies: string[];
  attachment: string; type: string; minMB: string; maxMB: string;
}
export const FILTER_DIMENSIONS = ["time", "categories", "tags", "payments", "currencies", "attachments"] as const;
export type FilterDimension = typeof FILTER_DIMENSIONS[number];
export function emptyDetailFilters(month: string): DetailFilters {
  return { month, from: "", to: "", categories: [], branches: [], tags: [], payments: [], currencies: [], attachment: "any", type: "", minMB: "", maxMB: "" };
}
const ARRAY_KEYS = ["categories", "branches", "tags", "payments", "currencies"] as const;
const TEXT_KEYS = ["from", "to", "attachment", "type", "minMB", "maxMB"] as const;
export function readDetailFilters(params: URLSearchParams, month: string): DetailFilters {
  const value = emptyDetailFilters(month);
  for (const key of ARRAY_KEYS) value[key] = [...new Set(params.getAll(`f.${key}`).filter(Boolean))];
  for (const key of TEXT_KEYS) value[key] = params.get(`f.${key}`) ?? value[key];
  const legacy = params.get("categoryId");
  if (legacy && !params.has("f.categories")) {
    value.categories = [legacy];
    if (params.get("categoryScope") === "branch") value.branches = [legacy];
  }
  value.branches = value.branches.filter(id => value.categories.includes(id));
  if (!isAllMonths(month)) { value.from = ""; value.to = ""; }
  return value;
}
export function writeDetailFilters(params: URLSearchParams, value: DetailFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("categoryId"); next.delete("categoryScope"); next.set("month", value.month);
  for (const key of ARRAY_KEYS) {
    next.delete(`f.${key}`);
    for (const item of value[key]) next.append(`f.${key}`, item);
  }
  for (const key of TEXT_KEYS) {
    next.delete(`f.${key}`);
    if (value[key] && !(key === "attachment" && value[key] === "any")) next.set(`f.${key}`, value[key]);
  }
  return next;
}
export function activeFilterDimensions(value: DetailFilters): FilterDimension[] {
  return FILTER_DIMENSIONS.filter(key => key === "time" ? !isAllMonths(value.month) || !!value.from || !!value.to
    : key === "attachments" ? value.attachment !== "any" || !!value.type || !!value.minMB || !!value.maxMB : value[key].length > 0);
}
export function clearFilterDimension(value: DetailFilters, key: FilterDimension): DetailFilters {
  if (key === "time") return { ...value, month: ALL_MONTHS, from: "", to: "" };
  if (key === "attachments") return { ...value, attachment: "any", type: "", minMB: "", maxMB: "" };
  return { ...value, [key]: [], ...(key === "categories" ? { branches: [] } : {}) };
}
export function detailFilterPredicate(value: DetailFilters, categories: readonly Category[]) {
  const categoryIds = new Set([...value.categories, ...categoryBranchIds(categories, value.branches)]);
  return (entry: Transaction): boolean => {
    const bytes = entry.storageBytes ?? 0;
    return (isAllMonths(value.month) || entry.occurredLocalDate.startsWith(value.month))
      && (!value.from || entry.occurredLocalDate >= value.from) && (!value.to || entry.occurredLocalDate <= value.to)
      && (!categoryIds.size || categoryIds.has(entry.categoryId))
      && (!value.payments.length || value.payments.includes(entry.paymentMethodId ?? "none"))
      && (!value.tags.length || entry.tags.some(tag => value.tags.includes(tag.id)))
      && (!value.currencies.length || value.currencies.includes(entry.currency))
      && (value.attachment === "any" || (value.attachment === "has" ? (entry.attachmentCount ?? 0) > 0 : (entry.attachmentCount ?? 0) === 0))
      && (!value.type || (entry.attachmentTypes ?? []).some(type => type.startsWith(value.type)))
      && (!value.minMB || bytes >= Number(value.minMB) * 1e6) && (!value.maxMB || bytes <= Number(value.maxMB) * 1e6);
  };
}
export function validFilterDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validDetailDates(value: DetailFilters): boolean {
  return (!value.from && !value.to) || (validFilterDate(value.from) && validFilterDate(value.to) && value.from <= value.to);
}
