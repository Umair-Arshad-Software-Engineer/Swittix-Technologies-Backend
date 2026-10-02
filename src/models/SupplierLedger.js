// src/models/SupplierLedger.js
module.exports = (sequelize, DataTypes) => {
    const SupplierLedger = sequelize.define('SupplierLedger', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        supplier_id: { type: DataTypes.INTEGER, allowNull: false },
        entry_type: {
            type: DataTypes.ENUM(
                'purchase',    // GR / direct purchase → we owe more
                'payment',     // we paid them
                'opening',     // opening balance
                'adjustment',  // manual correction, purchase return, etc.
            ),
            allowNull: false,
        },
        reference_id: { type: DataTypes.INTEGER, allowNull: true },      // GR id or PO id
        reference_number: { type: DataTypes.STRING, allowNull: true },   // GR number or PO number
        // Convention mirrors customer_ledger:
        //   debit  → we OWE them more  (purchase, opening with +balance)
        //   credit → we OWE them less  (payment)
        debit: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        credit: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        // current_balance_after = supplier.current_balance after this row
        balance_after: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        description: { type: DataTypes.STRING, allowNull: true },
        payment_method: { type: DataTypes.STRING(30), allowNull: true },
        bank: { type: DataTypes.STRING(100), allowNull: true },
        entry_date: { type: DataTypes.DATE, allowNull: false },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
    }, {
        tableName: 'supplier_ledger',
        timestamps: true,
    });

    SupplierLedger.associate = (models) => {
        SupplierLedger.belongsTo(models.Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
        SupplierLedger.belongsTo(models.User,     { foreignKey: 'created_by', as: 'creator' });
    };

    return SupplierLedger;
};