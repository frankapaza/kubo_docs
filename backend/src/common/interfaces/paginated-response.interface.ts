export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}
