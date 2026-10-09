// src/models/index.js

const { sequelize } = require('../config/db');
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');


// ============================================================
// IMPORT / INITIALIZE MODELS
// ============================================================

const UserModel = require('./User')(sequelize, DataTypes);

const ProductModel = require('./Product')(sequelize, DataTypes);

const CategoryModel = require('./category')(sequelize, DataTypes);

const BrandModel = require('./brand')(sequelize, DataTypes);

const UnitModel = require('./unit')(sequelize, DataTypes);

const SaleModel = require('./Sale')(sequelize, DataTypes);

const SaleItemModel = require('./saleItem')(sequelize, DataTypes);

const BranchModel = require('./branch')(sequelize, DataTypes);

const CustomerModel = require('./customer')(sequelize, DataTypes);

const CustomerPriceModel = require('./customerPrice')(sequelize, DataTypes);

const PriceHistoryModel = require('./priceHistory')(sequelize, DataTypes);

const SupplierModel = require('./supplier')(sequelize, DataTypes);

const InvoiceModel = require('./invoice')(sequelize, DataTypes);

const InvoiceItemModel = require('./invoiceItem')(sequelize, DataTypes);

const CustomerLedgerModel = require('./CustomerLedger')(sequelize, DataTypes);

const CashBookModel = require('./CashBook')(sequelize, DataTypes);

const BankTransactionModel = require('./BankTransaction')(sequelize, DataTypes);

const PurchaseOrderModel = require('./PurchaseOrder')(sequelize, DataTypes);
const PurchaseOrderItemModel = require('./PurchaseOrderItem')(sequelize, DataTypes);
const GoodsReceiptModel = require('./GoodsReceipt')(sequelize, DataTypes);
const GoodsReceiptItemModel = require('./GoodsReceiptItem')(sequelize, DataTypes);
const SupplierLedgerModel = require('./SupplierLedger')(sequelize, DataTypes);
const ExpenseSessionModel = require('./ExpenseSession')(sequelize, DataTypes);
const ExpenseEntryModel   = require('./ExpenseEntry')(sequelize, DataTypes);

// ============================================================
// USER ASSOCIATIONS
// ============================================================

UserModel.hasMany(ProductModel, { as: 'products', foreignKey: 'created_by' });
UserModel.hasMany(CategoryModel, { as: 'categories', foreignKey: 'created_by' });
UserModel.hasMany(BrandModel, { as: 'brands', foreignKey: 'created_by' });
UserModel.hasMany(UnitModel, { as: 'units', foreignKey: 'created_by' });
UserModel.hasMany(SaleModel, { as: 'sales', foreignKey: 'sold_by' });

UserModel.belongsTo(BranchModel, { foreignKey: 'branch_id', as: 'branch' });


// ============================================================
// BRANCH ASSOCIATIONS
// ============================================================

BranchModel.belongsTo(UserModel, { foreignKey: 'created_by', as: 'creator' });
BranchModel.hasMany(UserModel, { foreignKey: 'branch_id', as: 'users' });
BranchModel.hasMany(InvoiceModel, { as: 'invoices', foreignKey: 'branch_id' });

// ============================================================
// EXPENSE SESSION ASSOCIATIONS
// ============================================================
ExpenseSessionModel.belongsTo(BranchModel, { foreignKey: 'branch_id', as: 'branch' });
ExpenseSessionModel.belongsTo(UserModel,   { foreignKey: 'created_by', as: 'creator' });
ExpenseSessionModel.hasMany(ExpenseEntryModel, { foreignKey: 'session_id', as: 'entries' });

ExpenseEntryModel.belongsTo(ExpenseSessionModel, { foreignKey: 'session_id', as: 'session' });
ExpenseEntryModel.belongsTo(SupplierModel,       { foreignKey: 'supplier_id', as: 'supplier' });
ExpenseEntryModel.belongsTo(UserModel,           { foreignKey: 'created_by', as: 'creator' });

// ============================================================
// PRODUCT ASSOCIATIONS
// ============================================================

ProductModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
ProductModel.belongsTo(CategoryModel, { as: 'category', foreignKey: 'category_id' });
ProductModel.belongsTo(BrandModel, { as: 'brand', foreignKey: 'brand_id' });
ProductModel.belongsTo(UnitModel, { as: 'unit', foreignKey: 'unit_id' });
ProductModel.hasMany(SaleModel, { as: 'sales', foreignKey: 'product_id' });

// Useful for reports: how many times this product appears on purchases
ProductModel.hasMany(PurchaseOrderItemModel, {
    as: 'purchaseOrderItems',
    foreignKey: 'product_id',
});
ProductModel.hasMany(GoodsReceiptItemModel, {
    as: 'goodsReceiptItems',
    foreignKey: 'product_id',
});


// ============================================================
// CATEGORY ASSOCIATIONS
// ============================================================

CategoryModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
CategoryModel.hasMany(ProductModel, { as: 'products', foreignKey: 'category_id' });


// ============================================================
// BRAND ASSOCIATIONS
// ============================================================

BrandModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
BrandModel.hasMany(ProductModel, { as: 'products', foreignKey: 'brand_id' });


// ============================================================
// UNIT ASSOCIATIONS
// ============================================================

UnitModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
UnitModel.hasMany(ProductModel, { as: 'products', foreignKey: 'unit_id' });


// ============================================================
// SALE ASSOCIATIONS
// ============================================================

SaleModel.belongsTo(UserModel, { as: 'seller', foreignKey: 'sold_by' });
SaleModel.belongsTo(ProductModel, { as: 'product', foreignKey: 'product_id' });
SaleModel.hasMany(SaleItemModel, { foreignKey: 'sale_id', as: 'items' });


// ============================================================
// SALE ITEM ASSOCIATIONS
// ============================================================

SaleItemModel.belongsTo(SaleModel, { foreignKey: 'sale_id', as: 'sale' });
SaleItemModel.belongsTo(ProductModel, { foreignKey: 'product_id', as: 'product' });


// ============================================================
// USER PASSWORD HELPERS
// ============================================================

UserModel.prototype.verifyPassword = async function (password) {
    return await bcrypt.compare(password, this.password);
};

UserModel.hashPassword = async function (password) {
    return await bcrypt.hash(password, 10);
};


// ============================================================
// CUSTOMER ASSOCIATIONS
// ============================================================

CustomerModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
CustomerModel.belongsTo(BranchModel, { as: 'branch', foreignKey: 'branch_id' });
UserModel.hasMany(CustomerModel, { as: 'customers', foreignKey: 'created_by' });
BranchModel.hasMany(CustomerModel, { as: 'customers', foreignKey: 'branch_id' });


// ============================================================
// SUPPLIER ASSOCIATIONS
// ============================================================

SupplierModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
SupplierModel.belongsTo(BranchModel, { as: 'branch', foreignKey: 'branch_id' });
UserModel.hasMany(SupplierModel, { as: 'suppliers', foreignKey: 'created_by' });
BranchModel.hasMany(SupplierModel, { as: 'suppliers', foreignKey: 'branch_id' });


// ============================================================
// CUSTOMER PRICE ASSOCIATIONS
// ============================================================

CustomerPriceModel.belongsTo(CustomerModel, { as: 'customer', foreignKey: 'customer_id' });
CustomerPriceModel.belongsTo(ProductModel, { as: 'product', foreignKey: 'product_id' });
CustomerPriceModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });

CustomerModel.hasMany(CustomerPriceModel, { as: 'customerPrices', foreignKey: 'customer_id' });
ProductModel.hasMany(CustomerPriceModel, { as: 'customerPrices', foreignKey: 'product_id' });


// ============================================================
// PRICE HISTORY ASSOCIATIONS
// ============================================================

PriceHistoryModel.belongsTo(ProductModel, { as: 'product', foreignKey: 'product_id' });
PriceHistoryModel.belongsTo(CustomerModel, { as: 'customer', foreignKey: 'customer_id' });
PriceHistoryModel.belongsTo(CustomerPriceModel, { as: 'customerPrice', foreignKey: 'customer_price_id' });
PriceHistoryModel.belongsTo(UserModel, { as: 'changedByUser', foreignKey: 'changed_by' });

ProductModel.hasMany(PriceHistoryModel, { as: 'priceHistory', foreignKey: 'product_id' });
CustomerModel.hasMany(PriceHistoryModel, { as: 'priceHistory', foreignKey: 'customer_id' });
CustomerPriceModel.hasMany(PriceHistoryModel, { as: 'history', foreignKey: 'customer_price_id' });


// ============================================================
// INVOICE ASSOCIATIONS
// ============================================================

InvoiceModel.belongsTo(CustomerModel, { as: 'customer', foreignKey: 'customer_id' });
InvoiceModel.belongsTo(BranchModel, { as: 'branch', foreignKey: 'branch_id' });
InvoiceModel.belongsTo(UserModel, { as: 'creator', foreignKey: 'created_by' });
InvoiceModel.hasMany(InvoiceItemModel, { as: 'items', foreignKey: 'invoice_id' });

InvoiceItemModel.belongsTo(InvoiceModel, { as: 'invoice', foreignKey: 'invoice_id' });
InvoiceItemModel.belongsTo(ProductModel, { as: 'product', foreignKey: 'product_id' });

CustomerModel.hasMany(InvoiceModel, { as: 'invoices', foreignKey: 'customer_id' });


// ============================================================
// CUSTOMER LEDGER ASSOCIATIONS
// ============================================================

CustomerLedgerModel.belongsTo(CustomerModel, { foreignKey: 'customer_id', as: 'customer' });
CustomerLedgerModel.belongsTo(UserModel, { foreignKey: 'created_by', as: 'creator' });

// ⚠️ reference_id is POLYMORPHIC on the ledger (invoice id for invoice
// entries, bank-txn id for cheque-bounce adjustments, null for payments).
// constraints:false => keep the association for `include`, but do NOT
// create a database FOREIGN KEY (which would reject non-invoice ids).
CustomerLedgerModel.belongsTo(InvoiceModel, {
    foreignKey: 'reference_id',
    as: 'invoice',
    constraints: false,
});

CustomerModel.hasMany(CustomerLedgerModel, { as: 'ledgerEntries', foreignKey: 'customer_id' });


// ============================================================
// CASH BOOK ASSOCIATIONS
// ============================================================

CashBookModel.belongsTo(BranchModel, { foreignKey: 'branch_id', as: 'branch' });
CashBookModel.belongsTo(UserModel, { foreignKey: 'created_by', as: 'creator' });

// ⚠️ reference_id is polymorphic (ledger id, manual = null, etc.).
CashBookModel.belongsTo(CustomerLedgerModel, {
    foreignKey: 'reference_id',
    as: 'ledgerEntry',
    constraints: false,
});

BranchModel.hasMany(CashBookModel, { as: 'cashBookEntries', foreignKey: 'branch_id' });
UserModel.hasMany(CashBookModel, { as: 'cashBookEntries', foreignKey: 'created_by' });


// ============================================================
// BANK TRANSACTION ASSOCIATIONS
// ============================================================

BankTransactionModel.belongsTo(BranchModel, { foreignKey: 'branch_id', as: 'branch' });
BankTransactionModel.belongsTo(UserModel, { foreignKey: 'created_by', as: 'creator' });

// ⚠️ reference_id holds:
//   - customer_ledger.id   (customer payments)
//   - bank_transactions.id (the paired leg of a transfer)
//   - bank_transactions.id (the original cheque for a bounce reversal)
// A real FK to customer_ledger rejects the last two. constraints:false
// keeps the `ledgerEntry` association usable without the DB constraint.
BankTransactionModel.belongsTo(CustomerLedgerModel, {
    foreignKey: 'reference_id',
    as: 'ledgerEntry',
    constraints: false,
});

BranchModel.hasMany(BankTransactionModel, { as: 'bankTransactions', foreignKey: 'branch_id' });
UserModel.hasMany(BankTransactionModel, { as: 'bankTransactions', foreignKey: 'created_by' });


// ============================================================
// PURCHASE ORDER ASSOCIATIONS
// ============================================================

PurchaseOrderModel.belongsTo(SupplierModel, {
    as: 'supplier',
    foreignKey: 'supplier_id',
});
PurchaseOrderModel.belongsTo(BranchModel, {
    as: 'branch',
    foreignKey: 'branch_id',
});
PurchaseOrderModel.belongsTo(UserModel, {
    as: 'creator',
    foreignKey: 'created_by',
});
PurchaseOrderModel.hasMany(PurchaseOrderItemModel, {
    as: 'items',
    foreignKey: 'purchase_order_id',
});
PurchaseOrderModel.hasMany(GoodsReceiptModel, {
    as: 'receipts',
    foreignKey: 'purchase_order_id',
});

SupplierModel.hasMany(PurchaseOrderModel, {
    as: 'purchaseOrders',
    foreignKey: 'supplier_id',
});
BranchModel.hasMany(PurchaseOrderModel, {
    as: 'purchaseOrders',
    foreignKey: 'branch_id',
});


// ============================================================
// PURCHASE ORDER ITEM ASSOCIATIONS
// ============================================================

PurchaseOrderItemModel.belongsTo(PurchaseOrderModel, {
    as: 'purchaseOrder',
    foreignKey: 'purchase_order_id',
});
PurchaseOrderItemModel.belongsTo(ProductModel, {
    as: 'product',
    foreignKey: 'product_id',
});
PurchaseOrderItemModel.hasMany(GoodsReceiptItemModel, {
    as: 'receiptItems',
    foreignKey: 'purchase_order_item_id',
});


// ============================================================
// GOODS RECEIPT ASSOCIATIONS
// ============================================================

GoodsReceiptModel.belongsTo(PurchaseOrderModel, {
    as: 'purchaseOrder',
    foreignKey: 'purchase_order_id',
});
GoodsReceiptModel.belongsTo(SupplierModel, {
    as: 'supplier',
    foreignKey: 'supplier_id',
});
GoodsReceiptModel.belongsTo(UserModel, {
    as: 'receiver',
    foreignKey: 'received_by',
});
GoodsReceiptModel.hasMany(GoodsReceiptItemModel, {
    as: 'items',
    foreignKey: 'goods_receipt_id',
});

SupplierModel.hasMany(GoodsReceiptModel, {
    as: 'goodsReceipts',
    foreignKey: 'supplier_id',
});


// ============================================================
// GOODS RECEIPT ITEM ASSOCIATIONS
// ============================================================

GoodsReceiptItemModel.belongsTo(GoodsReceiptModel, {
    as: 'goodsReceipt',
    foreignKey: 'goods_receipt_id',
});
GoodsReceiptItemModel.belongsTo(PurchaseOrderItemModel, {
    as: 'purchaseOrderItem',
    foreignKey: 'purchase_order_item_id',
});
GoodsReceiptItemModel.belongsTo(ProductModel, {
    as: 'product',
    foreignKey: 'product_id',
});


// ============================================================
// SUPPLIER LEDGER ASSOCIATIONS
// ============================================================

SupplierLedgerModel.belongsTo(SupplierModel, { foreignKey: 'supplier_id', as: 'supplier' });
SupplierLedgerModel.belongsTo(UserModel,     { foreignKey: 'created_by',  as: 'creator' });
SupplierModel.hasMany(SupplierLedgerModel,   { as: 'ledgerEntries', foreignKey: 'supplier_id' });


// ============================================================
// EXPORT DATABASE OBJECT
// ============================================================

const db = {
    sequelize,
    User: UserModel,
    Product: ProductModel,
    Category: CategoryModel,
    Brand: BrandModel,
    Unit: UnitModel,
    Sale: SaleModel,
    SaleItem: SaleItemModel,
    Branch: BranchModel,
    Customer: CustomerModel,
    CustomerPrice: CustomerPriceModel,
    Supplier: SupplierModel,
    PriceHistory: PriceHistoryModel,
    Invoice: InvoiceModel,
    InvoiceItem: InvoiceItemModel,
    CustomerLedger: CustomerLedgerModel,
    CashBook: CashBookModel,
    BankTransaction: BankTransactionModel,
    PurchaseOrder: PurchaseOrderModel,
    PurchaseOrderItem: PurchaseOrderItemModel,
    GoodsReceipt: GoodsReceiptModel,
    GoodsReceiptItem: GoodsReceiptItemModel,
    SupplierLedger: SupplierLedgerModel,
    ExpenseSession: ExpenseSessionModel,
    ExpenseEntry:   ExpenseEntryModel,
};

module.exports = db;