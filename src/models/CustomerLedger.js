// src/models/CustomerLedger.js
module.exports = (sequelize, DataTypes) => {
    const CustomerLedger = sequelize.define('CustomerLedger', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        customer_id: { type: DataTypes.INTEGER, allowNull: false },
        entry_type: { type: DataTypes.ENUM('invoice', 'payment', 'opening', 'adjustment'), allowNull: false },
        reference_id: { type: DataTypes.INTEGER, allowNull: true }, // invoice id
        reference_number: { type: DataTypes.STRING, allowNull: true }, // invoice number
        debit: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },  // amount reduces what they owe (payment)
        credit: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 }, // amount increases what they owe (invoice)
        balance_after: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        description: { type: DataTypes.STRING, allowNull: true },
        // ✅ NEW — only meaningful for entry_type: 'payment', but kept
        // generic (nullable) so any entry type could carry them later.
        payment_method: { type: DataTypes.STRING(30), allowNull: true },
        bank: { type: DataTypes.STRING(100), allowNull: true },
        entry_date: { type: DataTypes.DATE, allowNull: false },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
    }, { tableName: 'customer_ledger', timestamps: true });

    CustomerLedger.associate = (models) => {
        CustomerLedger.belongsTo(models.Customer, { foreignKey: 'customer_id', as: 'customer' });
        CustomerLedger.belongsTo(models.Invoice, { foreignKey: 'reference_id', as: 'invoice' });
    };

    return CustomerLedger;
};