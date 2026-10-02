// src/models/CashBook.js
module.exports = (sequelize, DataTypes) => {
    const CashBook = sequelize.define('CashBook', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        entry_type: { 
            type: DataTypes.ENUM('receipt', 'payment', 'opening', 'adjustment'), 
            allowNull: false 
        },
        // receipt = cash coming IN (customer paid us)
        // payment = cash going OUT (we paid supplier/expense)
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        balance_after: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        description: { type: DataTypes.STRING, allowNull: true },
        reference_type: { type: DataTypes.STRING(30), allowNull: true }, // 'customer_payment', 'supplier_payment', 'expense'
        reference_id: { type: DataTypes.INTEGER, allowNull: true },
        reference_number: { type: DataTypes.STRING, allowNull: true },
        entry_date: { type: DataTypes.DATE, allowNull: false },
        branch_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
    }, { tableName: 'cash_book', timestamps: true });

    CashBook.associate = (models) => {
        CashBook.belongsTo(models.Branch, { foreignKey: 'branch_id', as: 'branch' });
        CashBook.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    };

    return CashBook;
};