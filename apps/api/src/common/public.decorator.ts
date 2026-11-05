import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Route yang boleh diakses tanpa sesi (login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
