import { FilterCriteriaEnum, QueryOrderingEnum } from '../enums';
import { WidgetTypeEnum } from '../enums/widget-type.enum';
import { OperationTypeEnum } from '../enums/operation-type.enum';

export interface IAutocompleteFields {
  fields: Array<string>;
  value: string;
}

export interface IConnection {
  type?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  schema?: string;
  sid?: string;
  ssh?: boolean;
  privateSSHKey?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  ssl?: boolean;
  cert?: string;
}

export interface ICustomFields {
  id: string;
  type: string;
  template_string: string;
  text: string;
  settings: ITableSettings;
}

export interface IFilteringFields {
  field: string;
  criteria: FilterCriteriaEnum;
  value: string;
}

export interface IForeignKeyInfo {
  referenced_column_name: string;
  referenced_table_name: string;
  constraint_name: string;
  column_name: string;
}

export interface IMessageData {
  data: IMessageDataInfo;
}
export interface IMessageDataInfo {
  operationType: OperationTypeEnum;
  tableName: string;
  row: any;
  primaryKey: any;
  tableSettings: ITableSettings;
  page: number;
  perPage: number;
  searchedFieldValue: string;
  filteringFields: Array<string>;
  autocompleteFields: Array<string>;
  email: string;
}

export interface IPaginationRO {
  total: number;
  lastPage: number;
  perPage: number;
  currentPage: number;
}

export interface IStructureInfo {
  column_type: string;
  data_type: string;
  column_default: string;
  column_name: string;
  allow_null: boolean;
}

export interface ITablePrimaryColumnInfo {
  data_type: string;
  column_name: string;
}

export interface ITableSettings {
  connection_id: string;
  table_name: string;
  display_name: string;
  search_fields: Array<string>;
  excluded_fields: Array<string>;
  list_fields: Array<string>;
  identification_fields: Array<string>;
  list_per_page: number;
  ordering: QueryOrderingEnum;
  ordering_field: string;
  readonly_fields: string[];
  sortable_by: string[];
  autocomplete_columns: string[];
  custom_fields?: Array<ICustomFields>;
  table_widgets?: Array<ITableWidget>;
}

export interface ITableWidget {
  id: string;
  field_name: string;
  widget_type: WidgetTypeEnum;
  widget_params: Array<string>;
  name?: string;
  description?: string;
  settings: ITableSettings;
}
