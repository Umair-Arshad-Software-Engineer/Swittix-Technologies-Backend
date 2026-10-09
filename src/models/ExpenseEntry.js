// src/models/ExpenseEntry.js
module.exports = (sequelize, DataTypes) => {
    const ExpenseEntry = sequelize.define('ExpenseEntry', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        session_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'expense_sessions', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        entry_type: {
            type: DataTypes.ENUM('expense', 'supplier_payment', 'bill_payment'),
            allowNull: false,
            defaultValue: 'expense',
        },
        category: { type: DataTypes.STRING(60),  allowNull: true },
        description: { type: DataTypes.STRING(255), allowNull: true },
        amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },

        payment_method: {
            type: DataTypes.ENUM('cash', 'bank', 'cheque', 'slip'),
            allowNull: false,
            defaultValue: 'cash',
        },

        // Bank / cheque
        bank_id:   { type: DataTypes.INTEGER, allowNull: true },
        bank_name: { type: DataTypes.STRING(100), allowNull: true },
        cheque_number: { type: DataTypes.STRING(50), allowNull: true },
        cheque_date:   { type: DataTypes.DATEONLY, allowNull: true },
        cheque_id:     { type: DataTypes.INTEGER, allowNull: true },

        // Supplier payment
        supplier_id: { type: DataTypes.INTEGER, allowNull: true },
        supplier_ledger_id: { type: DataTypes.INTEGER, allowNull: true },

        // Bill payment
        bill_type:    { type: DataTypes.STRING(40), allowNull: true },
        bill_name:    { type: DataTypes.STRING(100), allowNull: true },
        bill_number:  { type: DataTypes.STRING(60), allowNull: true },
        consumer_number: { type: DataTypes.STRING(60), allowNull: true },
        bill_image:   { type: DataTypes.TEXT('long'), allowNull: true }, // base64

        reference_number: { type: DataTypes.STRING(80), allowNull: true },
        entry_time: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'expense_entries',
        timestamps: true,
        indexes: [
            { fields: ['session_id'] },
            { fields: ['entry_type'] },
            { fields: ['supplier_id'] },
            { fields: ['entry_time'] },
        ],
    });

    ExpenseEntry.associate = (models) => {
        ExpenseEntry.belongsTo(models.ExpenseSession, { foreignKey: 'session_id', as: 'session' });
        ExpenseEntry.belongsTo(models.Supplier,       { foreignKey: 'supplier_id', as: 'supplier' });
        ExpenseEntry.belongsTo(models.User,           { foreignKey: 'created_by', as: 'creator' });
    };

    return ExpenseEntry;
};