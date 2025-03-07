import {
  isObjectEmpty,
  listTables,
  renameObjectKeyName,
  tableSettingsFieldValidator,
} from '../../helpers';
import { IDaoInterface } from '../shared/dao-interface';
import { BasicDao } from '../shared/basic-dao';
import { Constants } from '../../helpers/constants/constants';
import { FilterCriteriaEnum } from '../../enums';
import { TunnelCreator } from '../shared/tunnel-creator';
import { IConnection, ITableSettings } from '../../interfaces/interfaces';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const types = require('pg').types;
const timestampOID = 1114;
/*
types.setTypeParser(1114, function(stringValue) {
  return stringValue;
});

types.setTypeParser(1184, function(stringValue) {
  return stringValue;
});
*/
types.setTypeParser(1186, (stringValue) => stringValue);

export class DaoSshPostgres extends BasicDao implements IDaoInterface {
  private readonly connection: IConnection;

  constructor(connection: IConnection) {
    super();
    this.connection = connection;
  }

  async addRowInTable(tableName: string, row: any): Promise<any> {
    const knex = (await this.createTunneledKnex()) as any;
    const tableStructure = await this.getTableStructure(tableName);

    const jsonColumnNames = tableStructure
      .filter((structEl) => {
        return structEl.data_type.toLowerCase() === 'json';
      })
      .map((structEl) => {
        return structEl.column_name;
      });
    for (const key in row) {
      if (jsonColumnNames.includes(key)) {
        row[key] = JSON.stringify(row[key]);
      }
    }

    const primaryColumns = await this.getTablePrimaryColumns(tableName);
    const primaryKey = primaryColumns[0];
    tableStructure
      .map((e) => {
        return e.column_name;
      })
      .indexOf(primaryKey.column_name);
    if (primaryColumns?.length > 0) {
      const result = await knex(tableName)
        .withSchema(this.connection.schema ? this.connection.schema : 'public')
        .returning(primaryKey.column_name)
        .insert(row);
      return {
        [primaryKey.column_name]: result[0],
      };
    } else {
      const result = await knex(tableName)
        .withSchema(this.connection.schema ? this.connection.schema : 'public')
        .insert(row);
      return result;
    }
  }

  async deleteRowInTable(tableName: string, primaryKey: any): Promise<any> {
    const knex = (await this.createTunneledKnex()) as any;
    return await knex(tableName)
      .withSchema(this.connection.schema ? this.connection.schema : 'public')
      .returning(Object.keys(primaryKey))
      .where(primaryKey)
      .del();
  }

  async getRowByPrimaryKey(
    tableName,
    primaryKey,
    settings: ITableSettings,
  ): Promise<any> {
    const knex = await this.createTunneledKnex();
    if (!settings || isObjectEmpty(settings)) {
      return knex(tableName)
        .withSchema(this.connection.schema ? this.connection.schema : 'public')
        .where(primaryKey);
    }
    const availableFields = await this.findAvaliableFields(settings, tableName);
    return await knex
      .select(availableFields)
      .from(tableName)
      .withSchema(this.connection.schema ? this.connection.schema : 'public')
      .where(primaryKey);
  }

  async getRowsFromTable(
    tableName: string,
    settings: ITableSettings,
    page: number,
    perPage: number,
    searchedFieldValue: string,
    filteringFields: any,
    autocompleteFields: any,
  ): Promise<any> {
    /* eslint-disable */
    if (!page || page <= 0) {
      page = Constants.DEFAULT_PAGINATION.page;
      const { list_per_page } = settings;
      if ((list_per_page && list_per_page > 0) && (!perPage || perPage <= 0)) {
        perPage = list_per_page;
      } else {
        perPage = Constants.DEFAULT_PAGINATION.perPage;
      }
    }
    const knex = await this.createTunneledKnex();
    const count = await knex(tableName).withSchema(this.connection.schema ? this.connection.schema : 'public').count('*');
    const rowsCount = parseInt(count[0].count);
    const lastPage = Math.ceil((rowsCount) / perPage);
    /* eslint-enable */
    const availableFields = await this.findAvaliableFields(settings, tableName);

    let rowsRO;
    if (
      autocompleteFields &&
      !isObjectEmpty(autocompleteFields) &&
      autocompleteFields.value &&
      autocompleteFields.fields.length > 0
    ) {
      const rows = await knex
        .select(autocompleteFields.fields)
        .from(tableName)
        .withSchema(this.connection.schema ? this.connection.schema : 'public')
        .modify((builder) => {
          /*eslint-disable*/
          const { fields, value } = autocompleteFields;
          if (value !== '*') {
            for (const field of fields) {
              builder.orWhereRaw(`CAST (?? AS TEXT) LIKE '${value}%'`, [field]);
              //builder.orWhere(field, 'like', `${value}%`);
            }
          } else {
            return;
          }
          /*eslint-enable*/
        })
        .limit(Constants.AUTOCOMPLETE_ROW_LIMIT);

      rowsRO = {
        data: rows,
        pagination: {},
      };

      return rowsRO;
    }
    const rows = await knex
      .select(availableFields)
      .from(tableName)
      .withSchema(this.connection.schema ? this.connection.schema : 'public')
      .modify((builder) => {
        /*eslint-disable*/
        const { search_fields } = settings;
        if (searchedFieldValue && search_fields.length > 0) {
          for (const field of search_fields) {
            builder.orWhereRaw(` CAST (?? AS VARCHAR (255))=?`, [field, searchedFieldValue]);
          }
        }
        /*eslint-enable*/
      })
      .modify((builder) => {
        if (filteringFields && filteringFields.length > 0) {
          for (const filterObject of filteringFields) {
            const { field, criteria, value } = filterObject;
            switch (criteria) {
              case FilterCriteriaEnum.eq:
                builder.andWhere(field, '=', `${value}`);
                break;
              case FilterCriteriaEnum.startswith:
                builder.andWhere(field, 'like', `${value}%`);
                break;
              case FilterCriteriaEnum.endswith:
                builder.andWhere(field, 'like', `%${value}`);
                break;
              case FilterCriteriaEnum.gt:
                builder.andWhere(field, '>', value);
                break;
              case FilterCriteriaEnum.lt:
                builder.andWhere(field, '<', value);
                break;
              case FilterCriteriaEnum.lte:
                builder.andWhere(field, '<=', value);
                break;
              case FilterCriteriaEnum.gte:
                builder.andWhere(field, '>=', value);
                break;
              case FilterCriteriaEnum.contains:
                builder.andWhere(field, 'like', `%${value}%`);
                break;
              case FilterCriteriaEnum.icontains:
                builder.andWhereNot(field, 'like', `%${value}%`);
                break;
            }
          }
        }
      })
      .modify((builder) => {
        if (settings.ordering_field && settings.ordering) {
          builder.orderBy(settings.ordering_field, settings.ordering);
        }
      })
      .paginate({
        perPage: perPage,
        currentPage: page,
        isLengthAware: true,
      });
    const { data } = rows;
    let { pagination } = rows;
    pagination = {
      total: pagination.total ? pagination.total : rowsCount,
      lastPage: pagination.lastPage ? pagination.lastPage : lastPage,
      perPage: pagination.perPage,
      currentPage: pagination.currentPage,
    };
    rowsRO = {
      data,
      pagination,
    };
    return rowsRO;
  }

  async getTableForeignKeys(tableName: string): Promise<any> {
    const knex = await this.createTunneledKnex();
    const tableSchema = this.connection.schema
      ? this.connection.schema
      : 'public';
    const foreignKeys = await knex(tableName)
      .select(
        knex.raw(`tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name`),
      )
      .from(
        knex.raw(
          `information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name=?;`,
          [tableName, tableSchema],
        ),
      );

    const transformedForeignKeys = [];
    for (const foreignKey of foreignKeys) {
      transformedForeignKeys.push({
        /* eslint-disable */
        referenced_column_name: foreignKey.foreign_column_name,
        referenced_table_name: foreignKey.foreign_table_name,
        constraint_name: foreignKey.constraint_name,
        column_name: foreignKey.column_name,
        /* eslint-enable */
      });
    }
    return transformedForeignKeys;
  }

  async getTablePrimaryColumns(tableName: string): Promise<any> {
    const knex = (await this.createTunneledKnex()) as any;
    tableName = this.attachSchemaNameToTableName(tableName);
    const primaryColumns = await knex(tableName)
      .select(
        knex.raw(
          'a.attname, format_type(a.atttypid, a.atttypmod) AS data_type',
        ),
      )
      .from(knex.raw('pg_index i'))
      .join(
        knex.raw(
          'pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)',
        ),
      )
      .where(
        knex.raw(`i.indrelid = ?::regclass AND i.indisprimary;`, tableName),
      );

    const primaryColumnsToColumnName = [];
    for (const primaryColumn of primaryColumns) {
      primaryColumnsToColumnName.push({
        /* eslint-disable */
        column_name: primaryColumn.attname,
        data_type: primaryColumn.data_type,
        /* eslint-enable */
      });
    }

    return primaryColumnsToColumnName;
  }

  async getTablesFromDB(): Promise<any> {
    const knex = await this.createTunneledKnex();
    return await listTables(knex, this.connection.schema);
  }

  async getTableStructure(tableName: string): Promise<any> {
    const knex = (await this.createTunneledKnex()) as any;
    const result = await knex
      .select(
        'column_name',
        'column_default',
        'data_type',
        'udt_name',
        'is_nullable',
        'character_maximum_length',
      )
      .from('information_schema.columns')
      .where(`table_name`, tableName)
      .andWhere(
        'table_schema',
        this.connection.schema ? this.connection.schema : 'public',
      );

    const customTypeIndexes = [];
    for (let i = 0; i < result.length; i++) {
      result[i].is_nullable = result[i].is_nullable === 'YES';
      renameObjectKeyName(result[i], 'is_nullable', 'allow_null');
      if (result[i].data_type === 'USER-DEFINED') {
        customTypeIndexes.push(i);
      }
    }

    if (customTypeIndexes.length >= 0) {
      for (let i = 0; i < customTypeIndexes.length; i++) {
        const customTypeInTableName = result[customTypeIndexes[i]].udt_name;
        const customTypeAttrsQueryResult = await knex.raw(
          `select attname, format_type(atttypid, atttypmod)
              from pg_type
              join pg_class on pg_class.oid = pg_type.typrelid
              join pg_attribute on pg_attribute.attrelid = pg_class.oid
              where typname = ?
              order by attnum`,
          customTypeInTableName,
        );
        const customTypeAttrs = customTypeAttrsQueryResult.rows;
        const enumLabelQueryResult = await knex.raw(
          `SELECT e.enumlabel
                FROM pg_enum e
                JOIN pg_type t ON e.enumtypid = t.oid
                WHERE t.typname = ?`,
          customTypeInTableName,
        );
        let enumLabelRows = [];
        if (
          enumLabelQueryResult &&
          enumLabelQueryResult.rows &&
          enumLabelQueryResult.rows.length > 0
        ) {
          enumLabelRows = enumLabelQueryResult.rows;

          enumLabelRows = enumLabelRows.map((el) => {
            return el.enumlabel;
          });
        }
        if (enumLabelRows && enumLabelRows.length > 0) {
          result[customTypeIndexes[i]].data_type = 'enum';
          result[customTypeIndexes[i]].data_type_params = enumLabelRows;
        }

        if (customTypeAttrs && customTypeAttrs.length > 0) {
          const customDataTypeRo = [];
          for (const attr of customTypeAttrs) {
            customDataTypeRo.push({
              column_name: attr.attname,
              data_type: attr.format_type,
            });
          }
          result[customTypeIndexes[i]].data_type =
            result[customTypeIndexes[i]].udt_name;
          result[customTypeIndexes[i]].data_type_params = customDataTypeRo;
        }
      }
    }
    return result;
  }

  async testConnect(): Promise<boolean> {
    const knex = await this.createTunneledKnex();
    let result;
    try {
      result = await knex().select(1);
    } catch (e) {
      return false;
    }
    return !!result;
  }

  async updateRowInTable(
    tableName: string,
    row: any,
    primaryKey: any,
  ): Promise<any> {
    const tableStructure = await this.getTableStructure(tableName);
    const jsonColumnNames = tableStructure
      .filter((structEl) => {
        return structEl.data_type.toLowerCase() === 'json';
      })
      .map((structEl) => {
        return structEl.column_name;
      });
    for (const key in row) {
      if (jsonColumnNames.includes(key)) {
        row[key] = JSON.stringify(row[key]);
      }
    }

    const knex = (await this.createTunneledKnex()) as any;
    return await knex(tableName)
      .withSchema(this.connection.schema ? this.connection.schema : 'public')
      .returning(Object.keys(primaryKey))
      .where(primaryKey)
      .update(row);
  }

  async validateSettings(
    settings: ITableSettings,
    tableName,
  ): Promise<Array<string>> {
    const tableStructure = await this.getTableStructure(tableName);
    return tableSettingsFieldValidator(tableStructure, settings);
  }

  private async createTunneledKnex() {
    return await TunnelCreator.createTunneledKnex(this.connection);
  }

  private async findAvaliableFields(
    settings: ITableSettings,
    tableName: string,
  ): Promise<Array<string>> {
    let availableFields = [];
    if (isObjectEmpty(settings)) {
      const tableStructure = await this.getTableStructure(tableName);
      availableFields = tableStructure.map((el) => {
        return el.column_name;
      });
      return availableFields;
    }
    const excludedFields = settings.excluded_fields;
    if (settings.list_fields && settings.list_fields.length > 0) {
      availableFields = settings.list_fields;
    } else {
      const tableStructure = await this.getTableStructure(tableName);
      availableFields = tableStructure.map((el) => {
        return el.column_name;
      });
    }
    if (excludedFields && excludedFields.length > 0) {
      for (const field of excludedFields) {
        const delIndex = availableFields.indexOf(field);
        if (delIndex >= 0) {
          availableFields.splice(availableFields.indexOf(field), 1);
        }
      }
    }
    return availableFields;
  }

  private attachSchemaNameToTableName(tableName: string): string {
    if (this.connection.schema) {
      tableName = `"${this.connection.schema}"."${tableName}"`;
    } else {
      tableName = `"public"."${tableName}"`;
    }
    return tableName;
  }
}
