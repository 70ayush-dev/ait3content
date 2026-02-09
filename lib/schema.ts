import { z } from "zod";

export const metaSchema = z.object({
  vendorName: z.string().min(1),
  extensionKey: z.string().min(1),
  elementName: z.string().min(1),
  cTypeKey: z.string().min(1),
  iconName: z.string().min(1),
  group: z.string().min(1)
});

export type MetaForm = z.infer<typeof metaSchema>;
