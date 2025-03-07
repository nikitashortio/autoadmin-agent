import { createDao } from '../dal/shared/create-dao';
import { IConnection, IMessageData } from '../interfaces/interfaces';
import { Messages } from '../text/messages';
import { OperationTypeEnum } from '../enums/operation-type.enum';
import { LogOperationTypeEnum, OperationResultStatusEnum } from '../enums';
import { Logger } from '../helpers/app-logs/logger';

export class CommandExecutor {
  private readonly connectionConfig: IConnection;

  constructor(connectionConfig: IConnection) {
    this.connectionConfig = connectionConfig;
  }

  async executeCommand(messageData: IMessageData): Promise<any> {
    const dao = createDao(this.connectionConfig);
    const {
      operationType,
      tableName,
      row,
      primaryKey,
      tableSettings,
      page,
      perPage,
      searchedFieldValue,
      filteringFields,
      autocompleteFields,
      email,
    } = messageData.data;
    let operationStatusResult = OperationResultStatusEnum.unknown;
    switch (operationType) {
      case OperationTypeEnum.addRowInTable:
        try {
          operationStatusResult = OperationResultStatusEnum.successfully;
          return await dao.addRowInTable(tableName, row);
        } catch (e) {
          operationStatusResult = OperationResultStatusEnum.unsuccessfully;
          return null;
        } finally {
          Logger.createLogRecord(
            row,
            tableName,
            email,
            LogOperationTypeEnum.addRow,
            operationStatusResult,
            null,
          );
        }
        break;
      case OperationTypeEnum.deleteRowInTable:
        try {
          operationStatusResult = OperationResultStatusEnum.successfully;
          return await dao.deleteRowInTable(tableName, primaryKey);
        } catch (e) {
          operationStatusResult = OperationResultStatusEnum.unsuccessfully;
          return null;
        } finally {
          Logger.createLogRecord(
            primaryKey,
            tableName,
            email,
            LogOperationTypeEnum.deleteRow,
            operationStatusResult,
            null,
          );
        }
        break;
      case OperationTypeEnum.getRowByPrimaryKey:
        try {
          operationStatusResult = OperationResultStatusEnum.successfully;
          return await dao.getRowByPrimaryKey(
            tableName,
            primaryKey,
            tableSettings,
          );
        } catch (e) {
          operationStatusResult = OperationResultStatusEnum.unsuccessfully;
          return null;
        } finally {
          Logger.createLogRecord(
            primaryKey,
            tableName,
            email,
            LogOperationTypeEnum.rowReceived,
            operationStatusResult,
            null,
          );
        }
        break;
      case OperationTypeEnum.getRowsFromTable:
        try {
          operationStatusResult = OperationResultStatusEnum.successfully;
          return await dao.getRowsFromTable(
            tableName,
            tableSettings,
            page,
            perPage,
            searchedFieldValue,
            filteringFields,
            autocompleteFields,
          );
        } catch (e) {
          operationStatusResult = OperationResultStatusEnum.unsuccessfully;
          return null;
        } finally {
          Logger.createLogRecord(
            null,
            tableName,
            email,
            LogOperationTypeEnum.rowsReceived,
            operationStatusResult,
            null,
          );
        }
        break;
      case OperationTypeEnum.getTableForeignKeys:
        try {
          return await dao.getTableForeignKeys(tableName);
        } catch (e) {
          return null;
        }
      case OperationTypeEnum.getTablePrimaryColumns:
        try {
          return await dao.getTablePrimaryColumns(tableName);
        } catch (e) {
          return null;
        }
      case OperationTypeEnum.getTableStructure:
        try {
          return await dao.getTableStructure(tableName);
        } catch (e) {
          return null;
        }
      case OperationTypeEnum.getTablesFromDB:
        try {
          return await dao.getTablesFromDB();
        } catch (e) {
          return null;
        }
      case OperationTypeEnum.testConnect:
        try {
          return await dao.testConnect();
        } catch (e) {
          return null;
        }
      case OperationTypeEnum.updateRowInTable:
        try {
          operationStatusResult = OperationResultStatusEnum.successfully;
          return await dao.updateRowInTable(tableName, row, primaryKey);
        } catch (e) {
          operationStatusResult = OperationResultStatusEnum.unsuccessfully;
          return null;
        } finally {
          Logger.createLogRecord(
            row,
            tableName,
            email,
            LogOperationTypeEnum.updateRow,
            operationStatusResult,
            null,
          );
        }

      case OperationTypeEnum.validateSettings:
        try {
          operationStatusResult = OperationResultStatusEnum.successfully;
          return await dao.validateSettings(tableSettings, tableName);
        } catch (e) {
          operationStatusResult = OperationResultStatusEnum.unsuccessfully;
          return null;
        }
      default:
        throw new Error(Messages.UNKNOWN_OPERATION(operationType));
    }
  }
}
