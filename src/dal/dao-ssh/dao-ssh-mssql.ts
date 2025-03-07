import { IDaoInterface, IDaoRowsRO } from '../shared/dao-interface';
import {
  objectKeysToLowercase,
  tableSettingsFieldValidator,
  isObjectEmpty,
  renameObjectKeyName,
} from '../../helpers';
import { BasicDao } from '../shared/basic-dao';
import { Constants } from '../../helpers/constants/constants';
import { FilterCriteriaEnum, QueryOrderingEnum } from '../../enums';
import {
  IAutocompleteFields,
  IConnection,
  IFilteringFields,
  ITableSettings,
} from '../../interfaces/interfaces';
import { TunnelCreator } from '../shared/tunnel-creator';

export class DaoSshMssql extends BasicDao implements IDaoInterface {
  private readonly connection: IConnection;

  constructor(connection: IConnection) {
    super();
    this.connection = connection;
  }

  async addRowInTable(tableName: string, row: string): Promise<any> {
    const knex = await this.createTunneledKnex();
    const tableStructure = await this.getTableStructure(tableName);
    const primaryColumns = await this.getTablePrimaryColumns(tableName);
    const primaryKey = primaryColumns[0];
    tableStructure
      .map((e) => {
        return e.column_name;
      })
      .indexOf(primaryKey.column_name);
    const schemaName = await this.getSchemaName(tableName);
    tableName = `${schemaName}.[${tableName}]`;
    if (primaryColumns?.length > 0) {
      const result = await knex(tableName)
        .returning(primaryKey.column_name)
        .insert(row);
      return {
        [primaryKey.column_name]: result[0],
      };
    } else {
      const result = await knex(tableName).insert(row);
      return result;
    }
  }

  async deleteRowInTable(
    tableName: string,
    primaryKey: string,
  ): Promise<string> {
    const knex = await this.createTunneledKnex();
    const schemaName = await this.getSchemaName(tableName);
    tableName = `${schemaName}.[${tableName}]`;
    return await knex(tableName)
      .returning(Object.keys(primaryKey))
      .where(primaryKey)
      .del();
  }

  async getRowByPrimaryKey(
    tableName: string,
    primaryKey: string,
    settings: ITableSettings,
  ): Promise<Array<string>> {
    const knex = await this.createTunneledKnex();
    if (!settings || isObjectEmpty(settings)) {
      const schemaName = await this.getSchemaName(tableName);
      tableName = `${schemaName}.[${tableName}]`;
      return await knex(tableName).where(primaryKey);
    }
    const availableFields = await this.findAvaliableFields(settings, tableName);
    const schemaName = await this.getSchemaName(tableName);
    tableName = `${schemaName}.[${tableName}]`;
    return await knex.select(availableFields).from(tableName).where(primaryKey);
  }

  async getRowsFromTable(
    tableName: string,
    settings: ITableSettings,
    page: number,
    perPage: number,
    searchedFieldValue: string,
    filteringFields: Array<IFilteringFields>,
    autocompleteFields: IAutocompleteFields,
  ): Promise<IDaoRowsRO> {
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
    //todo ask
    const countQueryResult = await knex.raw(
      `SELECT
      QUOTENAME(SCHEMA_NAME(sOBJ.schema_id)) + '.' + QUOTENAME(sOBJ.name) AS [TableName]
      , SUM(sdmvPTNS.row_count) AS [RowCount]
      FROM
      sys.objects AS sOBJ
      INNER JOIN sys.dm_db_partition_stats AS sdmvPTNS
            ON sOBJ.object_id = sdmvPTNS.object_id
      WHERE
      sOBJ.type = 'U'
      AND sOBJ.is_ms_shipped = 0x0
      AND sdmvPTNS.index_id < 2
      GROUP BY
      sOBJ.schema_id
      , sOBJ.name
      ORDER BY [TableName]`,
    );

    let rowsCount = 0;
    let tableSchema = undefined;
    //for quering from mssql we need table schema name
    for (const row of countQueryResult) {
      if (row.TableName.includes(tableName)) {
        rowsCount = row['RowCount'];
        tableSchema = row.TableName.split('.')[0];
      }
    }

    const lastPage = Math.ceil((rowsCount) / perPage);
    /* eslint-enable */

    const availableFields = await this.findAvaliableFields(settings, tableName);
    let rowsRO;
    //for quering from mssql we need table schema name
    if (tableSchema) {
      tableName = `${tableSchema}.[${tableName}]`;
    }
    if (
      autocompleteFields &&
      !isObjectEmpty(autocompleteFields) &&
      autocompleteFields.value &&
      autocompleteFields.fields.length > 0
    ) {
      const rows = await knex
        .select(autocompleteFields.fields)
        .from(tableName)
        .modify((builder) => {
          /*eslint-disable*/
          const { fields, value } = autocompleteFields;
          if (value !== '*') {
            for (const field of fields) {
              builder.orWhere(field, 'like', `${value}%`);
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
    // for realisation pagination in mssql we need sorting in query. OFFSET and FETCH doesn't work
    // without order. Correct query example:
    // SELECT * FROM test_schema.Persons
    // ORDER BY ID
    // OFFSET 3 ROWS FETCH NEXT 3 ROWS ONLY
    if (!settings?.ordering_field) {
      settings.ordering_field = availableFields[0];
      settings.ordering = QueryOrderingEnum.ASC;
    }
    const rows = await knex
      .select(availableFields)
      .from(tableName)
      .modify((builder) => {
        /*eslint-disable*/
        const { search_fields } = settings;
        if (search_fields && searchedFieldValue && search_fields.length > 0) {
          for (const field of search_fields) {
            builder.orWhereRaw(` CAST (?? AS CHAR (255))=?`, [field, searchedFieldValue]);
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
      .orderBy(settings.ordering_field, settings.ordering)
      .paginate({
        perPage: perPage,
        currentPage: page,
        isLengthAware: true,
      });
    const { data } = rows;
    const receivedPagination = rows.pagination;
    const pagination = {
      total: receivedPagination.total ? receivedPagination.total : rowsCount,
      lastPage: receivedPagination.lastPage
        ? receivedPagination.lastPage
        : lastPage,
      perPage: receivedPagination.perPage,
      currentPage: receivedPagination.currentPage,
    };
    rowsRO = {
      data,
      pagination,
    };
    return rowsRO;
  }

  async getTableForeignKeys(tableName: string): Promise<Array<string>> {
    const knex = await this.createTunneledKnex();
    const foreignKeys = await knex.raw(
      `SELECT
    ccu.constraint_name AS constraint_name
    ,ccu.column_name AS column_name
    ,kcu.table_name AS referenced_table_name
    ,kcu.column_name AS referenced_column_name
    FROM INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
    INNER JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
        ON ccu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON kcu.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME
    WHERE ccu.TABLE_NAME = ?`,
      [tableName],
    );
    const foreignKeysInLowercase = [];
    for (const foreignKey of foreignKeys) {
      foreignKeysInLowercase.push(objectKeysToLowercase(foreignKey));
    }
    return foreignKeysInLowercase;
  }

  async getTablePrimaryColumns(tableName: string): Promise<any> {
    const knex = await this.createTunneledKnex();
    const primaryColumns = await knex.raw(
      `Select C.COLUMN_NAME
     , C.DATA_TYPE
      From INFORMATION_SCHEMA.COLUMNS As C
         Outer Apply (
      Select CCU.CONSTRAINT_NAME
      From INFORMATION_SCHEMA.TABLE_CONSTRAINTS As TC
             Join INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE As CCU
                  On CCU.CONSTRAINT_NAME = TC.CONSTRAINT_NAME
      Where TC.TABLE_SCHEMA = C.TABLE_SCHEMA
      And TC.TABLE_NAME = C.TABLE_NAME
      And TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
                    And CCU.COLUMN_NAME = C.COLUMN_NAME
      ) As Z
      Where C.TABLE_NAME = ? AND Z.CONSTRAINT_NAME is not null;`,
      [tableName],
    );

    const primaryColumnsInLowercase = [];

    for (const primaryColumn of primaryColumns) {
      primaryColumnsInLowercase.push(objectKeysToLowercase(primaryColumn));
    }
    return primaryColumnsInLowercase;
  }

  async getTableStructure(tableName: string): Promise<any> {
    const knex = await this.createTunneledKnex();
    const structureColumns = await knex
      .select(
        'COLUMN_NAME',
        'COLUMN_DEFAULT',
        'DATA_TYPE',
        'IS_NULLABLE',
        'CHARACTER_MAXIMUM_LENGTH',
      )
      .from('information_schema.COLUMNS')
      .where({
        table_catalog: this.connection.database,
        table_name: tableName,
      });

    let generatedColumns = await knex.raw(
      `select COLUMN_NAME
       from INFORMATION_SCHEMA.COLUMNS
       where COLUMNPROPERTY(object_id(TABLE_SCHEMA+'.'+TABLE_NAME), COLUMN_NAME, 'IsIdentity') = 1
       AND TABLE_CATALOG = ? AND TABLE_NAME = ?`,
      [this.connection.database, tableName],
    );
    generatedColumns = generatedColumns.map((e) => e.COLUMN_NAME);

    const structureColumnsInLowercase = [];
    for (const structureColumn of structureColumns) {
      structureColumnsInLowercase.push(objectKeysToLowercase(structureColumn));
    }
    for (const element of structureColumnsInLowercase) {
      renameObjectKeyName(element, 'is_nullable', 'allow_null');
      element.allow_null = element.allow_null === 'YES';
      if (generatedColumns.indexOf(element.column_name) >= 0) {
        element.column_default = 'autoincrement';
      }
    }
    return structureColumnsInLowercase;
  }

  async getTablesFromDB(): Promise<Array<string>> {
    const knex = await this.createTunneledKnex();
    let result = await knex.raw(
      `SELECT TABLE_NAME
      FROM ??.INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'`,
      [this.connection.database],
    );
    result = result.map((e) => {
      return e.TABLE_NAME;
    });
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
    row,
    primaryKey: string,
  ): Promise<string> {
    const knex = await this.createTunneledKnex();
    const schemaName = await this.getSchemaName(tableName);
    tableName = `${schemaName}.[${tableName}]`;
    return knex(tableName)
      .returning(Object.keys(primaryKey))
      .where(primaryKey)
      .update(row);
  }

  async validateSettings(
    settings: ITableSettings,
    tableName: string,
  ): Promise<Array<string>> {
    const tableStructure = await this.getTableStructure(tableName);
    return tableSettingsFieldValidator(tableStructure, settings);
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

  private async getSchemaName(tableName: string): Promise<string> {
    const knex = await this.createTunneledKnex();
    const queryResult = await knex.raw(`SELECT
      QUOTENAME(SCHEMA_NAME(sOBJ.schema_id)) + '.' + QUOTENAME(sOBJ.name) AS [TableName]
      , SUM(sdmvPTNS.row_count) AS [RowCount]
      FROM
      sys.objects AS sOBJ
      INNER JOIN sys.dm_db_partition_stats AS sdmvPTNS
            ON sOBJ.object_id = sdmvPTNS.object_id
      WHERE
      sOBJ.type = 'U'
      AND sOBJ.is_ms_shipped = 0x0
      AND sdmvPTNS.index_id < 2
      GROUP BY
      sOBJ.schema_id
      , sOBJ.name
      ORDER BY [TableName]`);
    let tableSchema = undefined;
    for (const row of queryResult) {
      if (row.TableName.includes(tableName)) {
        tableSchema = row.TableName.split('.')[0];
      }
    }
    return tableSchema;
  }

  private async createTunneledKnex() {
    return await TunnelCreator.createTunneledKnex(this.connection);
  }
}
