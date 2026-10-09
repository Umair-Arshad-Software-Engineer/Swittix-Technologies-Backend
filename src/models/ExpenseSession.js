// src/models/ExpenseSession.js
module.exports = (sequelize, DataTypes) => {
    const ExpenseSession = sequelize.define('ExpenseSession', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        session_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            unique: true,
        },
        opening_balance: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total_expenses: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total_supplier_payments: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total_bill_payments: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
            defaultValue: 0,
        },
        closing_balance: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
            defaultValue: 0,
        },
        is_closed: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        branch_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'branches', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'expense_sessions',
        timestamps: true,
        indexes: [
            { fields: ['session_date'] },
            { fields: ['branch_id'] },
            { fields: ['created_by'] },
        ],
    });

    ExpenseSession.associate = (models) => {
        ExpenseSession.belongsTo(models.Branch, { foreignKey: 'branch_id', as: 'branch' });
        ExpenseSession.belongsTo(models.User,   { foreignKey: 'created_by', as: 'creator' });
        ExpenseSession.hasMany(models.ExpenseEntry, { foreignKey: 'session_id', as: 'entries' });
    };

    return ExpenseSession;
};