// src/models/BankTransaction.js
module.exports = (sequelize, DataTypes) => {
    const BankTransaction = sequelize.define('BankTransaction', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        entry_type: { 
            type: DataTypes.ENUM('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'cheque_in', 'cheque_out'), 
            allowNull: false 
        },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        balance_after: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        bank_name: { type: DataTypes.STRING(100), allowNull: false },
        account_number: { type: DataTypes.STRING(50), allowNull: true },
        // Cheque-specific fields
        cheque_number: { type: DataTypes.STRING(50), allowNull: true },
        cheque_date: { type: DataTypes.DATEONLY, allowNull: true },
        cheque_status: { 
            type: DataTypes.ENUM('pending', 'cleared', 'bounced', 'cancelled'), 
            allowNull: true 
        },
        cheque_status_date: { type: DataTypes.DATEONLY, allowNull: true },
        // Reference to what this transaction is for
        reference_type: { type: DataTypes.STRING(30), allowNull: true },
        reference_id: { type: DataTypes.INTEGER, allowNull: true },
        reference_number: { type: DataTypes.STRING(100), allowNull: true },
        description: { type: DataTypes.STRING, allowNull: true },
        entry_date: { type: DataTypes.DATE, allowNull: false },
        branch_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
    }, { tableName: 'bank_transactions', timestamps: true });

    BankTransaction.associate = (models) => {
        BankTransaction.belongsTo(models.Branch, { foreignKey: 'branch_id', as: 'branch' });
        BankTransaction.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    };

    return BankTransaction;
};